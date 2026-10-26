FROM amazoncorretto:17-alpine
WORKDIR /app
COPY delivery-service/target/*.jar app.jar
EXPOSE 8085
ENTRYPOINT ["sh","-c","exec java $JAVA_OPTS -jar app.jar"]
