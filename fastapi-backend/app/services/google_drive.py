from __future__ import annotations
import io
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from app.config import settings


_DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]


def _get_service():
    creds = Credentials(
        token=None,
        refresh_token=settings.google_drive_refresh_token,
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        token_uri="https://oauth2.googleapis.com/token",
        scopes=_DRIVE_SCOPES,
    )
    creds.refresh(Request())
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _list_children(service, folder_id: str, mime_filter: str) -> list[dict]:
    files, page_token = [], None
    while True:
        resp = service.files().list(
            q=f"'{folder_id}' in parents and mimeType='{mime_filter}' and trashed=false",
            fields="nextPageToken, files(id, name)",
            pageSize=100,
            pageToken=page_token,
        ).execute()
        files.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return files


def list_subfolders(service, folder_id: str) -> list[dict]:
    return _list_children(service, folder_id, "application/vnd.google-apps.folder")


def list_pdfs(service, folder_id: str) -> list[dict]:
    return _list_children(service, folder_id, "application/pdf")


def download_file(service, file_id: str) -> bytes:
    request = service.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()
