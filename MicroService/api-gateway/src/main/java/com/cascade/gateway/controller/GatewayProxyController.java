package com.cascade.gateway.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.util.Collections;
import java.util.Enumeration;

@RestController
@CrossOrigin
public class GatewayProxyController {

    private final RestTemplate restTemplate;

    @Value("${service.order.url:http://localhost:8081}")
    private String orderServiceUrl;

    @Value("${service.payment.url:http://localhost:8082}")
    private String paymentServiceUrl;

    @Value("${service.inventory.url:http://localhost:8083}")
    private String inventoryServiceUrl;

    @Value("${service.shipping.url:http://localhost:8084}")
    private String shippingServiceUrl;

    @Value("${service.delivery.url:http://localhost:8085}")
    private String deliveryServiceUrl;

    @Value("${service.notification.url:http://localhost:8086}")
    private String notificationServiceUrl;

    public GatewayProxyController(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    @RequestMapping(value = {
            "/orders/**", "/order/**",
            "/payments/**", "/payment/**",
            "/inventory/**", "/inventories/**",
            "/shipping/**", "/shipments/**",
            "/delivery/**", "/deliveries/**",
            "/notification/**", "/notifications/**",
            // Fault-injection control endpoints (proxied per target service)
            // Usage: POST /fault/{service}/configure  e.g. /fault/order-service/configure
            // The gateway strips the service prefix and forwards /fault/configure to the right service
            "/fault/**"
            },
            method = {RequestMethod.GET, RequestMethod.POST, RequestMethod.PUT, RequestMethod.DELETE})
    public ResponseEntity<byte[]> proxyRequest(@RequestBody(required = false) byte[] body,
                                                HttpMethod method,
                                                HttpServletRequest request) {
        String requestURI = request.getRequestURI();
        String queryString = request.getQueryString();

        String targetBaseUrl = getTargetServiceUrl(requestURI);
        if (targetBaseUrl == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Target service not found".getBytes());
        }

        // For fault routes: /fault/{serviceName}/{action} → /fault/{action}
        String forwardUri = requestURI;
        if (requestURI.startsWith("/fault/")) {
            String[] parts = requestURI.split("/", 4); // ["","fault","serviceName","action?"]
            forwardUri = parts.length >= 4 ? "/fault/" + parts[3] : "/fault/status";
        }

        String fullUrl = targetBaseUrl + forwardUri + (queryString != null ? "?" + queryString : "");

        try {
            HttpHeaders reqHeaders = new HttpHeaders();
            Enumeration<String> headerNames = request.getHeaderNames();
            if (headerNames != null) {
                while (headerNames.hasMoreElements()) {
                    String name = headerNames.nextElement();
                    if (!name.equalsIgnoreCase("host") &&
                        !name.equalsIgnoreCase("content-length") &&
                        !name.equalsIgnoreCase("transfer-encoding")) {
                        reqHeaders.put(name, Collections.list(request.getHeaders(name)));
                    }
                }
            }

            HttpEntity<byte[]> entity = new HttpEntity<>(body, reqHeaders);
            ResponseEntity<byte[]> response = restTemplate.exchange(URI.create(fullUrl), method, entity, byte[].class);

            HttpHeaders respHeaders = new HttpHeaders();
            if (response.getHeaders() != null) {
                response.getHeaders().forEach((key, values) -> {
                    if (!key.equalsIgnoreCase("transfer-encoding") &&
                        !key.equalsIgnoreCase("content-length") &&
                        !key.equalsIgnoreCase("connection")) {
                        respHeaders.put(key, values);
                    }
                });
            }

            return new ResponseEntity<>(response.getBody(), respHeaders, response.getStatusCode());
        } catch (org.springframework.web.client.HttpStatusCodeException e) {
            HttpHeaders respHeaders = new HttpHeaders();
            if (e.getResponseHeaders() != null) {
                e.getResponseHeaders().forEach((key, values) -> {
                    if (!key.equalsIgnoreCase("transfer-encoding") &&
                        !key.equalsIgnoreCase("content-length") &&
                        !key.equalsIgnoreCase("connection")) {
                        respHeaders.put(key, values);
                    }
                });
            }
            return new ResponseEntity<>(e.getResponseBodyAsByteArray(), respHeaders, e.getStatusCode());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(("Gateway Error: " + e.getMessage()).getBytes());
        }
    }

    private String getTargetServiceUrl(String uri) {
        if (uri.startsWith("/order")) {
            return orderServiceUrl;
        } else if (uri.startsWith("/payment")) {
            return paymentServiceUrl;
        } else if (uri.startsWith("/inventory") || uri.startsWith("/inventories")) {
            return inventoryServiceUrl;
        } else if (uri.startsWith("/shipping") || uri.startsWith("/shipments")) {
            return shippingServiceUrl;
        } else if (uri.startsWith("/delivery") || uri.startsWith("/deliveries")) {
            return deliveryServiceUrl;
        } else if (uri.startsWith("/notification")) {
            return notificationServiceUrl;
        }
        // Fault-injection routes: /fault/{serviceName}/configure|reset|status
        // e.g. /fault/order-service/configure → http://order-service:8081/fault/configure
        if (uri.startsWith("/fault/")) {
            String[] parts = uri.split("/", 4); // ["", "fault", "serviceName", "action"]
            if (parts.length >= 3) {
                return switch (parts[2]) {
                    case "order-service"        -> orderServiceUrl;
                    case "payment-service"      -> paymentServiceUrl;
                    case "inventory-service"    -> inventoryServiceUrl;
                    case "shipping-service"     -> shippingServiceUrl;
                    case "delivery-service"     -> deliveryServiceUrl;
                    case "notification-service" -> notificationServiceUrl;
                    default -> null;
                };
            }
        }
        return null;
    }
}
