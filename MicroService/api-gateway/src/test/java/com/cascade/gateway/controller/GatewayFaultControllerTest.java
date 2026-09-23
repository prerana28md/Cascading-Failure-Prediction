package com.cascade.gateway.controller;

import com.cascade.gateway.fault.FaultEventSynchronizer;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

public class GatewayFaultControllerTest {

    private GatewayFaultController controller;

    @BeforeEach
    public void setUp() {
        RestTemplate restTemplate = new RestTemplate();
        FaultEventSynchronizer synchronizer = new FaultEventSynchronizer(
                new ObjectMapper(),
                "http://localhost:5001/api/fault-events",
                "target/test-outbox.jsonl",
                "target/test-history.jsonl"
        );
        controller = new GatewayFaultController(restTemplate, synchronizer);
    }

    @Test
    public void testNormalizeServiceName() {
        assertEquals("order-service", controller.normalizeServiceName("order-service"));
        assertEquals("order-service", controller.normalizeServiceName("order"));
        assertEquals("payment-service", controller.normalizeServiceName("Payment-Service"));
        assertEquals("inventory-service", controller.normalizeServiceName("INVENTORY"));
        assertNull(controller.normalizeServiceName("unknown-service"));
    }

    @Test
    public void testValidationRejectsInvalidService() {
        Map<String, Object> req = Map.of("service", "non-existent", "faultType", "LATENCY", "delayMs", 1000);
        ResponseEntity<Map<String, Object>> response = controller.configureRoot(req);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertTrue(response.getBody().get("error").toString().contains("Invalid or unknown service"));
    }

    @Test
    public void testValidationRejectsInvalidFaultType() {
        Map<String, Object> req = Map.of("service", "order", "faultType", "EXPLODE");
        ResponseEntity<Map<String, Object>> response = controller.configureRoot(req);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertTrue(response.getBody().get("error").toString().contains("Unknown fault type"));
    }

    @Test
    public void testValidationRejectsNegativeDelay() {
        Map<String, Object> req = Map.of("service", "order", "faultType", "LATENCY", "delayMs", -500);
        ResponseEntity<Map<String, Object>> response = controller.configureRoot(req);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertTrue(response.getBody().get("error").toString().contains("delayMs cannot be negative"));
    }
}
