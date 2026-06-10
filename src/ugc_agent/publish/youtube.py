from __future__ import annotations

"""YouTube Shorts adapter (YouTube Data API v3).

Setup:
1. Google Cloud Console -> enable "YouTube Data API v3".
2. Create an OAuth client (Desktop app), download JSON to
   secrets/youtube_client_secret.json.
3. pip install google-api-python-client google-auth-oauthlib
4. First post opens a browser to authorize; token cached at
   secrets/youtube_token.json.
"""

from pathlib import Path

from .base import PublishAdapter

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
CLIENT_SECRET = Path("secrets/youtube_client_secret.json")
TOKEN = Path("secrets/youtube_token.json")


class YouTubeAdapter(PublishAdapter):
    platform = "youtube"

    def _service(self):
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build

        creds = None
        if TOKEN.exists():
            creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not CLIENT_SECRET.exists():
                    raise RuntimeError(f"Missing {CLIENT_SECRET} — see module docstring.")
                flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), SCOPES)
                creds = flow.run_local_server(port=0)
            TOKEN.parent.mkdir(exist_ok=True)
            TOKEN.write_text(creds.to_json())
        return build("youtube", "v3", credentials=creds)

    def post(self, video: Path, metadata: dict) -> str:
        from googleapiclient.http import MediaFileUpload

        service = self._service()
        tags = [h.lstrip("#") for h in metadata.get("hashtags", [])]
        body = {
            "snippet": {
                "title": metadata["title"][:100],
                "description": metadata["caption"],
                "tags": tags[:30],
                "categoryId": "28",  # Science & Technology
            },
            "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False},
        }
        media = MediaFileUpload(str(video), mimetype="video/mp4", resumable=True)
        request = service.videos().insert(part="snippet,status", body=body, media_body=media)
        response = None
        while response is None:
            _, response = request.next_chunk()
        return f"https://youtube.com/shorts/{response['id']}"
