// Architecture: ../../implementation-architecture.svg#O2; ui-flow.svg#U4.
// Shared HTTP boundary: failed/unreachable requests never become success receipts.
export async function request<T> (path: string, options?: RequestInit): Promise<T>
{
  let response: Response
  try
  {
    response = await fetch ('/api' + path, options)
  }
  catch
  {
    throw new Error ('The backend is unreachable. Your action is not confirmed. Check the connection and retry.')
  }
  if (!response.ok)
  {
    const body = await response.json ().catch (() => null)
    throw new Error (typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status}).`)
  }
  return response.status === 204 ? undefined as T : response.json ()
}

export function json (body: unknown): RequestInit
{
  return {headers: {'Content-Type': 'application/json'}, body: JSON.stringify (body)}
}
