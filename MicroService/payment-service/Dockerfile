FROM amazoncorretto:17-alpine
WORKDIR /app
COPY payment-service/target/*.jar app.jar
EXPOSE 8082
ENTRYPOINT ["sh","-c","exec java $JAVA_OPTS -jar app.jar"]
