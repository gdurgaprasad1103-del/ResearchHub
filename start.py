"""Start ResearchHub from the main folder:   python start.py"""
import sys, pathlib, uvicorn

BACKEND = pathlib.Path(__file__).resolve().parent / "backend"
sys.path.insert(0, str(BACKEND))

if __name__ == "__main__":
    uvicorn.run("main:app", app_dir=str(BACKEND), reload=True,
                reload_dirs=[str(BACKEND)], host="127.0.0.1", port=8000)