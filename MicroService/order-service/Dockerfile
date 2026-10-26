FROM amazoncorretto:17-alpine
WORKDIR /app
COPY order-service/target/*.jar app.jar
EXPOSE 8081
ENTRYPOINT ["sh","-c","exec java $JAVA_OPTS -jar app.jar"]
