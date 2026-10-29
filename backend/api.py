"""HTTP interface. Run one process: python -m uvicorn backend.api:app --port 8000.

Architecture: ../implementation-architecture.svg#O3 (HTTP boundary).
"""

import hashlib
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response

from .filing import DIMENSIONS, FilingWorkflow
from .models import DocumentMove, ManualSave, NewText, Profile, RecordCreate, Recheck
from .departments import CATALOG
from .processing import MAX_BYTES, MAX_PAGES, MAX_TEXT, MEDIA
from .storage import Conflict, Library
from .members import match_profile
from .chat import Question, MetadataSave, chat, metadata_save
from .processing import ProcessingError
from . import processing


load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def create_app(path=None):
    library = Library(Path(path or os.getenv("LIBRARY_PATH", "data/library.sqlite3")))
    workflow = FilingWorkflow(library)

    @asynccontextmanager
    async def lifespan(app):
        # import-pipeline.svg#B12: interrupted work becomes retryable on startup.
        library.recover()
        library.index_pending()
        app.state.executor = ThreadPoolExecutor(max_workers=1)
        yield
        app.state.executor.shutdown(wait=True)

    app = FastAPI(title="Medical Activity Tracker", lifespan=lifespan)
    app.state.library = library

    @app.exception_handler(KeyError)
    async def missing(_request, _error):
        return JSONResponse(status_code=404, content={"detail": "This file or profile is unavailable."})

    @app.exception_handler(Conflict)
    async def conflict(_request, error):
        return JSONResponse(status_code=409, content={"detail": str(error)})

    @app.exception_handler(sqlite3.Error)
    async def storage_error(_request, _error):
        return JSONResponse(status_code=503, content={"detail": "Storage failed. The action is not confirmed. Retry before assuming this content is stored."})

    def config():
        service = "OpenAI-compatible API · " + processing.service_name("primary")
        if processing.backup_configured():
            service += " | " + processing.service_name("backup")
        revision = hashlib.sha256((service + '|chat-disclosure-v3-viewer').encode()).hexdigest()[:16]
        return dict(service=service, disclosure=revision, configured=bool(os.getenv("OPENAI_API_KEY")),
                    max_bytes=MAX_BYTES, max_pages=MAX_PAGES, max_text=MAX_TEXT, extensions=list(MEDIA))

    def consent(value):
        # ../src/import/ui-flow.svg#U3: enforce the disclosed service revision here too.
        if value != config()["disclosure"]:
            raise HTTPException(428, "Review and accept the processing disclosure before submitting content.")

    def operation(value):
        if not value or len(value) > 100:
            raise HTTPException(400, "A stable upload operation key is required.")

    def schedule(record):
        # import-pipeline.svg#B1: one in-process worker; SQLite retains pending state.
        if record["status"] == "pending":
            app.state.executor.submit(workflow.run, record["id"])
        return record

    @app.get("/api/config")
    def get_config():
        return config()

    @app.post("/api/chat")
    def ask(body: Question, x_processing_consent: str = Header()):
        consent(x_processing_consent)
        try:
            return chat(library, body)
        except ProcessingError as error:
            raise HTTPException(502, str(error)) from error

    @app.put("/api/chat/metadata")
    def chat_metadata(body: MetadataSave):
        # Diagram 07: only an explicit, reviewable UI action commits metadata.
        return metadata_save(library, body)

    @app.get("/api/files")
    def list_files():
        return library.list()

    # database-schema.svg#D2: archive ownership is explicit; dates never merge files.
    @app.get("/api/records")
    def records(patient_id: str | None = None, department_code: str | None = None, disease: str | None = None):
        return library.records(patient_id=patient_id, department_code=department_code, disease=disease)

    @app.get("/api/records/{record_id}")
    def get_record(record_id: str):
        return library.record(record_id)

    @app.post("/api/records", status_code=201)
    def create_record(body: RecordCreate):
        record = library.create_record(body.title.strip(), body.patient_id)
        library.index_pending()
        return library.record(record["id"])

    @app.get("/api/departments")
    def department_catalog():
        return CATALOG

    @app.put("/api/files/{file_id}/record")
    def move_document(file_id: str, body: DocumentMove):
        library.move_document(file_id, body.record_id, body.revision)
        library.index_pending()
        return library.get(file_id)

    @app.get("/api/files/{file_id}")
    def get_file(file_id: str):
        return library.get(file_id)

    @app.get("/api/files/{file_id}/original")
    def original(file_id: str):
        record = library.get(file_id)
        return Response(library.source(file_id), media_type=record["media"],
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @app.post("/api/imports", status_code=202)
    async def upload(file: UploadFile = File(), record_id: str | None = Form(None), idempotency_key: str = Header(), x_processing_consent: str = Header()):
        # library-storage.svg#S2: validate input before the atomic source/pending save.
        consent(x_processing_consent)
        operation(idempotency_key)
        title = Path(file.filename or "document").name[:200]
        media = MEDIA.get(Path(title).suffix.lower())
        if not media:
            raise HTTPException(415, "Choose JPEG, PNG, WebP, PDF, or UTF-8 .txt. HEIC is not supported in this draft.")
        source = await file.read(MAX_BYTES + 1)
        await file.close()
        if not source or len(source) > MAX_BYTES:
            raise HTTPException(413, "Choose a nonempty file of at most 20 MiB.")
        return schedule(library.create(operation=idempotency_key, source=source,
                                       title=title, media=media, origin="imported", record_id=record_id))

    @app.post("/api/texts", status_code=202)
    def new_text(body: NewText, idempotency_key: str = Header(), x_processing_consent: str = Header()):
        # ../src/import/ui-flow.svg#U2: this endpoint is reached only after explicit Save.
        consent(x_processing_consent)
        operation(idempotency_key)
        if not body.text.strip() or len(body.text) > MAX_TEXT:
            raise HTTPException(413, f"Enter nonblank text of at most {MAX_TEXT:,} characters.")
        return schedule(library.create(operation=idempotency_key, source=body.text.encode(),
                                       title=body.title, media="text/plain", origin="user_entered", record_id=body.record_id))

    @app.post("/api/files/{file_id}/retry", status_code=202)
    def retry(file_id: str, x_processing_consent: str = Header()):
        consent(x_processing_consent)
        return schedule(workflow.retry(file_id))

    @app.put("/api/files/{file_id}/manual")
    def manual(file_id: str, body: ManualSave):
        # ../src/import/ui-flow.svg#U7: an explicit correction has its own write path.
        if not body.text.strip() or len(body.text) > MAX_TEXT:
            raise HTTPException(413, f"Enter nonblank text of at most {MAX_TEXT:,} characters.")
        profile = next((item for item in library.profiles() if item["id"] == body.member_id), None)
        if body.member_id and not profile:
            raise HTTPException(400, "Choose an existing family member or leave unassigned.")
        member_name = body.member_name.strip() if body.member_name is not None else profile["name"] if profile else ""
        if body.member_name is not None:
            profile = match_profile(member_name, library.profiles())

        def apply(record):
            # library-storage.svg#S5: reject a stale editor revision before changing data.
            if record["revision"] != body.revision:
                raise Conflict("This record changed. Reopen it before saving your draft.")
            changed = record["text"] != body.text
            metadata = {}
            values = dict(member=[member_name] if member_name else [], date=[body.date] if body.date.strip() else [],
                          department=body.department, disease=body.disease)
            for key in DIMENSIONS:
                entries = [dict(value=value.strip(), quote="", **({"profile_id": profile["id"]} if key == "member" and profile else {}))
                           for value in values[key] if value.strip()]
                metadata[key] = dict(status="known" if entries else "missing", values=entries, candidates=[], provenance="user_supplied")
            if record["metadata"]:
                for key in DIMENSIONS:
                    if ([value["value"] for value in metadata[key]["values"]] ==
                        [value["value"] for value in record["metadata"][key]["values"]]):
                        metadata[key] = record["metadata"][key]
            record.update(text=body.text, metadata=metadata, status="filed", stage="complete", error=None, attempt=None)
            if changed:
                # library-storage.svg#S5: preserve source/initial text; stale checks stay visible.
                record.update(text_origin="user_edited", check_status="stale", index={"saved_text": body.text})
            # Rebuild retrieval from saved text and current fields in this transaction.
            # Drop old AI clinical terms when their supporting text has changed.
            record["index"] = {**(record["index"] or {}), "saved_text": body.text, "classifications": metadata}
            record["index_status"] = "current"

        library.change(file_id, apply)
        library.index_pending()
        return library.get(file_id)

    @app.post("/api/files/{file_id}/recheck")
    def recheck(file_id: str, body: Recheck, x_processing_consent: str = Header()):
        consent(x_processing_consent)
        record = library.get(file_id)
        if record["revision"] != body.revision or record["status"] in ("pending", "processing"):
            raise Conflict("This record changed or is processing. Reopen its saved text before checking.")
        if not record["text"] or not record["text"].strip():
            raise HTTPException(400, "Save document text before requesting Recheck.")
        if len(record["text"]) > MAX_TEXT:
            raise HTTPException(413, f"Checking is limited to {MAX_TEXT:,} characters.")
        # Check outside the storage transaction. A concurrent edit/deletion must
        # invalidate this result, never attach it to different saved evidence.
        try:
            values = dict(check_status="checked", check_error=None, concerns=processing.check(record["text"]))
        except ProcessingError as error:
            values = dict(check_status="failed", check_error=str(error))

        def apply(current):
            if current["revision"] != body.revision:
                raise Conflict("This record changed during Recheck. Check its current saved text again.")
            current.update(**values)

        library.change(file_id, apply)
        library.index_pending()
        return library.get(file_id)

    @app.delete("/api/files/{file_id}", status_code=204)
    def delete(file_id: str):
        # library-storage.svg#S7: delete the selected identity and every stored derivative.
        library.delete(file_id)
        library.index_pending()
        return Response(status_code=204)

    @app.get("/api/profiles")
    def profiles():
        return library.profiles()

    @app.post("/api/profiles", status_code=201)
    def create_profile(body: Profile):
        # library-storage.svg#S8: profiles are shared family labels, not user accounts.
        if not body.name.strip() or any(not alias.strip() for alias in body.aliases):
            raise HTTPException(400, "Enter a name and nonblank aliases.")
        profile = library.save_profile(body.model_dump())
        library.index_pending()
        return profile

    @app.put("/api/profiles/{profile_id}")
    def update_profile(profile_id: str, body: Profile):
        # library-storage.svg#S8: correct the existing profile without inventing a new identity.
        if not body.name.strip() or any(not alias.strip() for alias in body.aliases):
            raise HTTPException(400, "Enter a name and nonblank aliases.")
        profile = library.save_profile(body.model_dump(), profile_id)
        library.index_pending()
        return profile

    @app.delete("/api/profiles/{profile_id}", status_code=204)
    def delete_profile(profile_id: str):
        library.delete_profile(profile_id)
        library.index_pending()
        return Response(status_code=204)

    return app


app = create_app()
