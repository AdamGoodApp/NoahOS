FROM python:3.12-slim
ENV MUJOCO_GL=osmesa SIM_DATA_DIR=/data PYOPENGL_PLATFORM=osmesa PYTHONUNBUFFERED=1 MENAGERIE_DIR=/opt/menagerie PATH="/app/.venv/bin:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends libosmesa6 libgl1 libglu1-mesa git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv
ARG MENAGERIE_COMMIT=f3b6013629c7b94f8ee93fd977b161fa8350f9bc
RUN git clone --filter=blob:none --no-checkout https://github.com/google-deepmind/mujoco_menagerie /opt/menagerie \
 && cd /opt/menagerie && git sparse-checkout init --cone \
 && git sparse-checkout set unitree_g1 unitree_h1 robotis_op3 google_robot hello_robot_stretch unitree_a1 unitree_go1 unitree_go2 anybotics_anymal_b anybotics_anymal_c google_barkour_v0 google_barkour_vb boston_dynamics_spot franka_emika_panda franka_fr3 universal_robots_ur5e universal_robots_ur10e kuka_iiwa_14 ufactory_xarm7 rethink_robotics_sawyer ufactory_lite6 trossen_vx300s trossen_wx250s aloha unitree_z1 \
 && git checkout $MENAGERIE_COMMIT && rm -rf .git
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY robots.yaml ./
RUN uv sync --frozen --no-dev
RUN mkdir -p /data
EXPOSE 8000
CMD ["noahos-sim", "serve", "--host", "0.0.0.0", "--port", "8000"]
