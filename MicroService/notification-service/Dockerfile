FROM amazoncorretto:17-alpine
WORKDIR /app
COPY notification-service/target/*.jar app.jar
EXPOSE 8086
ENTRYPOINT ["sh","-c","exec java $JAVA_OPTS -jar app.jar"]
