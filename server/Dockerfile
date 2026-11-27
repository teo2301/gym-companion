# gym-social: stdlib HTTP API + Pillow (image re-encoding strips EXIF/GPS). Code is bind-mounted at /app,
# so code changes only need a restart; rebuild only when requirements.txt changes.
FROM python:3.13-alpine
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt
USER 1000:1000
ENV PYTHONDONTWRITEBYTECODE=1 DATA_DIR=/data PORT=8000
CMD ["python", "-u", "/app/social.py"]
