FROM golang:1.26 AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/laam-api ./cmd/server

FROM gcr.io/distroless/base-debian12:nonroot

WORKDIR /app

COPY --from=build /out/laam-api /app/laam-api

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/app/laam-api"]
