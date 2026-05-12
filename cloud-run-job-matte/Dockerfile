# Cloud Run Job for the rembg subject-matte pipeline.
# Runs as a one-shot container task with always-on CPU (Cloud Run Jobs allocate
# full CPU for the entire run; no throttling-during-await like the main service).
#
# Triggered by the gstar-ai-studio main service via the Cloud Run Jobs API.
# Inputs/outputs flow through GCS (env vars on each execution).
#
# Pre-bakes U²-Net (~176MB) so per-execution start has no model download cost.

FROM python:3.11-slim

# OS deps for Pillow + opencv that rembg pulls in transitively.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Python deps. Pin numba<0.60 + coverage==7.4.4 to dodge the upstream
# rembg/numba/coverage incompatibility that breaks `import rembg` on newer pulls.
RUN pip install --no-cache-dir \
        Pillow \
        numpy==1.26.4 \
        google-cloud-storage \
        'rembg[cpu]' \
        'numba<0.60' \
        'coverage==7.4.4'

# Pre-download u2net (kept after isnet revert 2026-05-11 — see subject_matte.py).
# First exec pays ~30s download otherwise; pre-bake makes cold-start fast.
RUN python -c "from rembg import new_session; new_session('u2net')"

WORKDIR /app
COPY subject_matte.py .
COPY job_main.py .

# Cloud Run Jobs invokes the container's CMD/ENTRYPOINT once per execution.
CMD ["python", "job_main.py"]
