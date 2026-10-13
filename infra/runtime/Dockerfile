# Build all runtime boundaries from the same tested source and lockfile.
FROM node:22-bookworm-slim AS build
WORKDIR /opt/aijob
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages packages
COPY vendor/reactive-resume vendor/reactive-resume
COPY apps apps
COPY config config
COPY infra/runtime/prepare-runtime.mjs infra/runtime/prepare-runtime.mjs
RUN pnpm install --frozen-lockfile
ENV VITE_CAREER_OS_V2=1
RUN pnpm build
RUN AIJOB_IMAGE_BUILD=1 node infra/runtime/prepare-runtime.mjs

FROM node:22-bookworm-slim AS browser-dependencies
RUN apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install --no-install-recommends -y ca-certificates && sed -i "s|http://deb.debian.org|https://deb.debian.org|g" /etc/apt/sources.list.d/debian.sources && apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install --no-install-recommends -y chromium fonts-noto-cjk python3-fonttools ca-certificates tini && rm -rf /var/lib/apt/lists/*
COPY infra/runtime/font.py /tmp/aijob-font.py
RUN python3 /tmp/aijob-font.py && rm /tmp/aijob-font.py

FROM browser-dependencies AS platform
WORKDIR /opt/aijob
COPY --from=build --chown=node:node /opt/aijob /opt/aijob
COPY --from=build /opt/aijob/apps/web/public/fonts/AijobV3* /opt/fonts/
COPY --from=build /opt/aijob/apps/web/public/fonts/font-set-v3.json /opt/fonts/font-set-v3.json
RUN mkdir -p /opt/aijob/.data && chown node:node /opt/aijob/.data
ENV XDG_CONFIG_HOME=/tmp/chromium-config XDG_CACHE_HOME=/tmp/chromium-cache
ENV AIJOB_RESUME_FONT_DIR=/opt/fonts
ENV NODE_ENV=production COLLECTOR_BROWSER_EXECUTABLE=/usr/bin/chromium PDF_BROWSER_EXECUTABLE=/usr/bin/chromium PDF_FONT_PATH=/opt/fonts/AijobCJK.otf PDF_SERIF_FONT_PATH=/opt/fonts/AijobSerifCJK.otf
USER node
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","apps/platform/dist/collector-worker.js"]

# Networkless one-shot parser: caller fixes the image digest, resources and stdin.
FROM node:22-bookworm-slim AS resume-parser
WORKDIR /opt/aijob
COPY --from=build /opt/aijob/node_modules node_modules
COPY --from=build /opt/aijob/apps/platform/node_modules apps/platform/node_modules
COPY --from=build /opt/aijob/apps/platform/package.json apps/platform/package.json
COPY --from=build /opt/aijob/apps/platform/dist/resume/resume-parser-child.js apps/platform/dist/resume/resume-parser-child.js
USER 65532:65532
ENTRYPOINT ["node","--max-old-space-size=192","/opt/aijob/apps/platform/dist/resume/resume-parser-child.js"]

FROM nginxinc/nginx-unprivileged:stable-alpine AS web
COPY --from=build /opt/aijob/apps/web/dist /usr/share/nginx/html
COPY infra/runtime/nginx.conf /etc/nginx/conf.d/default.conf
