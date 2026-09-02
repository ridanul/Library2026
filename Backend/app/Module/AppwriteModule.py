import os
from pathlib import Path

from dotenv import load_dotenv
from appwrite.client import Client
from appwrite.services.storage import Storage

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

client = Client()
client.set_endpoint(os.getenv("APPWRITE_ENDPOINT", "https://cloud.appwrite.io/v1"))
client.set_project(os.getenv("APPWRITE_PROJECT_ID", ""))
client.set_key(os.getenv("APPWRITE_API_KEY", ""))

storage = Storage(client)