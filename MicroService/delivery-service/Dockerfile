FROM amazoncorretto:17-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY target/*.jar app.jar
EXPOSE 8085
ENTRYPOINT ["sh","-c","echo 'nameserver 8.8.8.8\nnameserver 8.8.4.4' > /etc/resolv.conf && java $JAVA_OPTS -jar app.jar"]
