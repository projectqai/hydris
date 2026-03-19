FROM alpine:latest
ARG TARGETARCH
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY bin/hydris-${TARGETARCH:-amd64} hydris
EXPOSE 50051
ENTRYPOINT ["./hydris"]
