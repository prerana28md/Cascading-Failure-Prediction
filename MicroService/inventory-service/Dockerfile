FROM amazoncorretto:17-alpine
WORKDIR /app
COPY inventory-service/target/*.jar app.jar
EXPOSE 8083
ENTRYPOINT ["sh","-c","exec java $JAVA_OPTS -jar app.jar"]
