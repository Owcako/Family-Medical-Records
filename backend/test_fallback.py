"""Quota routing uses real SDK HTTP errors and never real credentials/network."""

import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import APIStatusError

from backend import processing
from backend.api import create_app
from backend.chat import Question, chat
from backend.storage import Library
from backend.test_storage import add, ready


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    for name, value in dict(OPENAI_API_KEY='primary-test-key', OPENAI_BASE_URL='https://primary.invalid/v1',
                            OPENAI_MODEL='primary-model', BACKUP_API_KEY='backup-test-key',
                            BACKUP_BASE_URL='https://backup.invalid/v1', BACKUP_MODEL='backup-model').items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(processing, '_primary_retry_at', 0.0)


def transport(monkeypatch, handle):
    original = processing.OpenAI
    monkeypatch.setattr(processing, 'OpenAI', lambda **options: original(**options,
        http_client=httpx.Client(transport=httpx.MockTransport(handle))))


def completion(name, arguments):
    return httpx.Response(200, json=dict(id='test', created=0, object='chat.completion', model='test', choices=[dict(
        index=0, finish_reason='tool_calls', message=dict(role='assistant', content=None, tool_calls=[dict(
            id='test-call', type='function', function=dict(name=name, arguments=json.dumps(arguments)))]))]))


def test_key_url_model_switch_together_and_cooldown_recovers(monkeypatch):
    requests = []
    def handle(request):
        body = json.loads(request.content)
        requests.append((request.url.host, request.headers['authorization'], body['model']))
        if request.url.host == 'primary.invalid':
            return httpx.Response(429, headers={'Retry-After': '120'}, json={'error': {'message': 'Quota exhausted'}})
        return httpx.Response(200, json={'id': 'test', 'created': 0, 'object': 'chat.completion', 'model': 'backup-model',
                                       'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': 'OK'}}]})
    transport(monkeypatch, handle)

    @processing.quota_fallback
    def ask():
        with processing.client() as api:
            return api.chat.completions.create(model=processing.model(), messages=[{'role': 'user', 'content': 'Test'}])

    ask()
    assert requests == [('primary.invalid', 'Bearer primary-test-key', 'primary-model'),
                        ('backup.invalid', 'Bearer backup-test-key', 'backup-model')]
    assert processing._primary_retry_at >= time.monotonic() + 119
    ask()
    assert requests[-1][0] == 'backup.invalid' and len(requests) == 3
    monkeypatch.setattr(processing, '_primary_retry_at', 0.0)
    ask()
    assert requests[-2][0] == 'primary.invalid'
    assert processing._provider.get() is None


@pytest.mark.parametrize('status', [400, 401, 403, 500, 503])
def test_other_errors_do_not_switch_credentials(monkeypatch, status):
    hosts = []
    def handle(request):
        hosts.append(request.url.host)
        return httpx.Response(status, json={'error': {'message': 'Failure'}})
    transport(monkeypatch, handle)

    @processing.quota_fallback
    def ask():
        with processing.client() as api:
            return api.chat.completions.create(model=processing.model(), messages=[])

    with pytest.raises(APIStatusError):
        ask()
    assert hosts == ['primary.invalid']


def test_deepseek_uses_documented_forced_tool_mode_only_for_its_endpoint(monkeypatch):
    assert processing.completion_options() == {}
    monkeypatch.setenv('BACKUP_BASE_URL', 'https://api.deepseek.com')
    token = processing._provider.set('backup')
    try:
        assert processing.completion_options() == {'extra_body': {'thinking': {'type': 'disabled'}}}
    finally:
        processing._provider.reset(token)
    assert processing.completion_options() == {}


def test_partial_backup_configuration_never_mixes_providers(monkeypatch):
    monkeypatch.delenv('BACKUP_MODEL')
    hosts = []
    def handle(request):
        hosts.append(request.url.host)
        return httpx.Response(429, json={'error': {'message': 'Quota exhausted'}})
    transport(monkeypatch, handle)
    with pytest.raises(processing.ProcessingError, match='429'):
        processing.check('A fictional record')
    assert hosts == ['primary.invalid']


@pytest.mark.parametrize('invalid_schema', [False, True])
def test_literal_ocr_controls_preserve_quotes_without_bypassing_schema(monkeypatch, invalid_schema):
    text = 'Patient\tJohn\nAge\t180'
    def handle(request):
        result = completion('report_concerns', dict(concerns=[dict(quote=text, reason='Age exceeds 150')]))
        body = result.json()
        call = body['choices'][0]['message']['tool_calls'][0]['function']
        call['arguments'] = call['arguments'].replace('\\t', '\t').replace('\\n', '\n')
        if invalid_schema:
            call['arguments'] = call['arguments'].replace('"concerns"', '"unexpected"')
        return httpx.Response(200, json=body)
    transport(monkeypatch, handle)
    if invalid_schema:
        with pytest.raises(processing.ProcessingError, match='invalid result'):
            processing.check(text)
    else:
        assert processing.check(text) == [dict(quote=text, reason='Age exceeds 150', start=0, end=len(text))]


def test_chat_restarts_on_backup_without_replaying_primary_tool_history(tmp_path, monkeypatch):
    library = Library(tmp_path / 'fallback.sqlite3')
    file = ready(library, add(library, 'report'))
    primary_calls = 0
    backup_calls = 0

    def handle(request):
        nonlocal primary_calls, backup_calls
        body = json.loads(request.content)
        if request.url.host == 'primary.invalid':
            primary_calls += 1
            if primary_calls == 1:
                return completion('read_documents', dict(file_ids=[file['id']]))
            return httpx.Response(429, json={'error': {'message': 'Quota exhausted'}})
        backup_calls += 1
        assert body['model'] == 'backup-model'
        if backup_calls == 1:
            assert not any(message.get('role') == 'tool' for message in body['messages'])
            return completion('read_documents', dict(file_ids=[file['id']]))
        return completion('finish_answer', dict(claims=[dict(text='A recorded fact', citations=[dict(file_id=file['id'], quote='saved text')])],
                                               explanation='', limitation=''))

    transport(monkeypatch, handle)
    result = chat(library, Question(message='What is documented?'))
    assert primary_calls == 2 and backup_calls == 3  # read, draft, final evidence review
    assert result['service'] == 'Quota fallback · backup.invalid · backup-model'
    assert library.get(file['id'])['revision'] == file['revision']


def test_both_quotas_exhausted_fail_without_false_answer(tmp_path, monkeypatch):
    hosts = []
    def handle(request):
        hosts.append(request.url.host)
        return httpx.Response(429, json={'error': {'message': 'Quota exhausted'}})
    transport(monkeypatch, handle)
    with pytest.raises(processing.ProcessingError, match='primary AI quota.*backup could not complete'):
        chat(Library(tmp_path / 'empty.sqlite3'), Question(message='What is recorded?'))
    assert hosts == ['primary.invalid', 'backup.invalid']


def test_disclosure_names_both_services_without_keys(tmp_path):
    app = create_app(tmp_path / 'config.sqlite3')
    with TestClient(app) as client:
        config = client.get('/api/config').json()
    assert 'primary.invalid' in config['service'] and 'backup.invalid' in config['service']
    assert 'backup-model' in config['service']
    assert 'primary-test-key' not in str(config) and 'backup-test-key' not in str(config)
