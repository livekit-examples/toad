import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://dots:dots@localhost:5432/dots_test")
os.environ.setdefault("AGENT_API_KEY", "test-agent-key")
