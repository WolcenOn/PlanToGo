FROM golang:1.24-alpine AS builder
WORKDIR /app

COPY go.mod ./
COPY . .

RUN go mod tidy \
    && go mod verify \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /plantogo ./cmd/api

FROM alpine:3.21
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder /plantogo /usr/local/bin/plantogo
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/docs ./docs
USER app
EXPOSE 8080
CMD ["plantogo"]
