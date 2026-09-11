FROM amazoncorretto:17-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY target/*.jar app.jar
EXPOSE 8086
# Override DNS to Google's resolvers so MongoDB Atlas SRV lookups work in Docker on Windows
ENTRYPOINT ["sh","-c","echo 'nameserver 8.8.8.8\nnameserver 8.8.4.4' > /etc/resolv.conf && java $JAVA_OPTS -jar app.jar"]
