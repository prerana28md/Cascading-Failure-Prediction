FROM amazoncorretto:17-alpine
WORKDIR /app
COPY shipping-service/target/*.jar app.jar
EXPOSE 8084
ENTRYPOINT ["sh","-c","exec java $JAVA_OPTS -jar app.jar"]
