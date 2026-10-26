import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test.db")
os.environ.setdefault("APP_SECRET", "test-secret")
os.environ.setdefault("VERIFY_TOKEN", "test-verify")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
