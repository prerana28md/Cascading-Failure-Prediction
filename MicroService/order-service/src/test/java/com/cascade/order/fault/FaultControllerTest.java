package com.cascade.order.fault;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

public class FaultControllerTest {

    private FaultState faultState;
    private FaultInterceptor interceptor;
    private FaultController controller;

    @BeforeEach
    public void setUp() {
        faultState = new FaultState();
        interceptor = new FaultInterceptor(faultState);
        controller = new FaultController(faultState);
    }

    @Test
    public void testDefaultStateIsNone() {
        ResponseEntity<Map<String, Object>> response = controller.status();
        assertEquals(200, response.getStatusCode().value());
        assertNotNull(response.getBody());
        assertEquals("NONE", response.getBody().get("fault"));
        assertEquals(0, response.getBody().get("delayMs"));
        assertEquals(false, response.getBody().get("active"));
    }

    @Test
    public void testConfigureLatencySpike() {
        Map<String, Object> req = Map.of("faultType", "LATENCY", "delayMs", 1500);
        ResponseEntity<Map<String, Object>> res = controller.configure(req);
        assertEquals(200, res.getStatusCode().value());
        assertEquals("LATENCY", res.getBody().get("fault"));
        assertEquals(1500, res.getBody().get("delayMs"));
        assertEquals(true, res.getBody().get("active"));

        ResponseEntity<Map<String, Object>> statusRes = controller.status();
        assertEquals("LATENCY", statusRes.getBody().get("fault"));
        assertEquals(1500, statusRes.getBody().get("delayMs"));
        assertEquals(true, statusRes.getBody().get("active"));
    }

    @Test
    public void testConfigureErrorStorm() {
        Map<String, Object> req = Map.of("fault", "ERROR");
        ResponseEntity<Map<String, Object>> res = controller.configure(req);
        assertEquals(200, res.getStatusCode().value());
        assertEquals("ERROR", res.getBody().get("fault"));
        assertEquals(true, res.getBody().get("active"));
    }

    @Test
    public void testConfigureDownService() {
        Map<String, Object> req = Map.of("fault", "DOWN");
        ResponseEntity<Map<String, Object>> res = controller.configure(req);
        assertEquals(200, res.getStatusCode().value());
        assertEquals("DOWN", res.getBody().get("fault"));
        assertEquals(true, res.getBody().get("active"));
    }

    @Test
    public void testResetFault() {
        controller.configure(Map.of("fault", "ERROR"));
        assertEquals(true, controller.status().getBody().get("active"));

        ResponseEntity<Map<String, Object>> resetRes = controller.reset();
        assertEquals(200, resetRes.getStatusCode().value());
        assertEquals("NONE", resetRes.getBody().get("fault"));
        assertEquals(0, resetRes.getBody().get("delayMs"));
        assertEquals(false, resetRes.getBody().get("active"));
    }

    @Test
    public void testInterceptorPassesActuatorAndFaultEndpointsRegardlessOfFault() throws Exception {
        controller.configure(Map.of("fault", "DOWN"));

        MockHttpServletRequest reqActuator = new MockHttpServletRequest("GET", "/actuator/health");
        MockHttpServletResponse resActuator = new MockHttpServletResponse();
        boolean passActuator = interceptor.preHandle(reqActuator, resActuator, new Object());
        assertTrue(passActuator, "/actuator/** must always pass even when service is DOWN");

        MockHttpServletRequest reqFault = new MockHttpServletRequest("GET", "/fault/status");
        MockHttpServletResponse resFault = new MockHttpServletResponse();
        boolean passFault = interceptor.preHandle(reqFault, resFault, new Object());
        assertTrue(passFault, "/fault/** must always pass even when service is DOWN");
    }

    @Test
    public void testInterceptorBlocksWithError500() throws Exception {
        controller.configure(Map.of("fault", "ERROR"));

        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/orders");
        MockHttpServletResponse res = new MockHttpServletResponse();

        boolean pass = interceptor.preHandle(req, res, new Object());
        assertFalse(pass, "Requests should be intercepted when ERROR fault is active");
        assertEquals(500, res.getStatus());
        assertTrue(res.getContentAsString().contains("SERVICE_ERROR"));
    }

    @Test
    public void testInterceptorBlocksWithDown503() throws Exception {
        controller.configure(Map.of("fault", "DOWN"));

        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/orders");
        MockHttpServletResponse res = new MockHttpServletResponse();

        boolean pass = interceptor.preHandle(req, res, new Object());
        assertFalse(pass, "Requests should be intercepted when DOWN fault is active");
        assertEquals(503, res.getStatus());
        assertTrue(res.getContentAsString().contains("SERVICE_DOWN"));
    }
}
