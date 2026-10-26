FROM amazoncorretto:17-alpine
WORKDIR /app
COPY api-gateway/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["sh","-c","exec java $JAVA_OPTS -jar app.jar"]
