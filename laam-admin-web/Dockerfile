FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
# node:24-alpine의 기본 npm(11.19.x)은 optional dependency 그래프 검증이 더 엄격해
# 이 lockfile의 심층 optional 항목(예: next의 optional sharp -> wasm32 fallback ->
# @emnapi/runtime 체인)을 npm ci 단계에서 누락으로 오판하고 실패한다. 로컬 개발에서
# 검증된 npm 11.6.2로 고정해 동일한 lockfile로 결정적으로 설치한다.
RUN npm install -g npm@11.6.2
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* 값은 `npm run build` 시점에 클라이언트 번들에 그대로 박히므로,
# 컨테이너 실행 시점 환경변수(Cloud Run 서비스의 --set-env-vars/--set-secrets)로
# 넣어도 이 빌드 단계에는 전달되지 않는다. 빌드 시점에 --build-arg 또는
# gcloud run deploy --source ... --set-build-env-vars로 값을 넘겨야 한다.
# 둘 다 비워두면 features/notifications의 Realtime Broadcast 구독이
# lib/supabase/client.ts의 설계대로 조용히 비활성화되고(60초 안전망 폴링은
# 계속 동작), 빌드 자체는 그대로 성공한다.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

EXPOSE 8080

CMD ["node", "server.js"]
