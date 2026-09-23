package com.cascade.order.service;

import com.cascade.order.dto.OrderStatusUpdateRequest;
import com.cascade.order.entity.Order;
import com.cascade.order.exception.InsufficientStockException;
import com.cascade.order.exception.OrderNotFoundException;
import com.cascade.order.exception.ProductNotFoundException;
import com.cascade.order.repository.OrderRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class OrderService {

    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    private final OrderRepository orderRepository;
    private final RestTemplate restTemplate;

    @Value("${service.inventory.url:http://localhost:8083}")
    private String inventoryServiceUrl;

    @Value("${service.payment.url:http://localhost:8082}")
    private String paymentServiceUrl;

    @Value("${service.shipping.url:http://localhost:8084}")
    private String shippingServiceUrl;

    @Value("${service.notification.url:http://localhost:8086}")
    private String notificationServiceUrl;

    public OrderService(OrderRepository orderRepository, RestTemplate restTemplate) {
        this.orderRepository = orderRepository;
        this.restTemplate    = restTemplate;
    }

    // ── Place a new order ─────────────────────────────────────────────────────

    /**
     * Validates stock BEFORE persisting the order.
     * Throws InsufficientStockException / ProductNotFoundException on failure.
     */
    @SuppressWarnings("unchecked")
    public Order processOrder(Order order) {

        if (order.getQuantity() == null || order.getQuantity() <= 0) {
            throw new IllegalArgumentException("Quantity must be greater than 0");
        }
        if (order.getProductId() == null) {
            throw new IllegalArgumentException("productId is required");
        }

        // ── 1. STOCK CHECK (before any persistence) ───────────────────────────
        Map<String, Object> inventoryReq = new HashMap<>();
        inventoryReq.put("productId", order.getProductId());
        inventoryReq.put("quantity",  order.getQuantity());

        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(
                    inventoryServiceUrl + "/inventory/deduct", inventoryReq, Map.class);

            if (!response.getStatusCode().is2xxSuccessful()) {
                // Treat any non-2xx from inventory as a stock failure
                log.warn("Inventory service returned non-2xx: {}", response.getStatusCode());
                failOrder(order, "Inventory check failed: " + response.getStatusCode());
                throw new InsufficientStockException(order.getProductId(),
                        order.getQuantity(), 0);
            }
            log.info("Stock deducted for product={} qty={}", order.getProductId(), order.getQuantity());

        } catch (HttpClientErrorException.NotFound e) {
            // 404 → product not in inventory catalogue
            log.error("Product {} not found in inventory", order.getProductId());
            throw new ProductNotFoundException(order.getProductId());

        } catch (HttpClientErrorException.BadRequest e) {
            // 400 → "Insufficient stock" returned by InventoryController
            Map<String, Object> errorBody = parseErrorBody(e);
            int available = errorBody.containsKey("available")
                    ? Integer.parseInt(errorBody.get("available").toString()) : 0;
            log.error("Insufficient stock for product={} requested={} available={}",
                    order.getProductId(), order.getQuantity(), available);
            throw new InsufficientStockException(order.getProductId(),
                    order.getQuantity(), available);

        } catch (HttpClientErrorException e) {
            // Other 4xx
            log.error("Inventory service client error: {}", e.getMessage());
            throw new InsufficientStockException(order.getProductId(),
                    order.getQuantity(), 0);

        } catch (Exception e) {
            // Inventory service is unreachable – fail fast, don't take the order
            log.error("Inventory service unavailable: {}", e.getMessage());
            throw new RuntimeException(
                    "Inventory service is currently unavailable. Please try again later.");
        }

        // ── 2. Persist order as CONFIRMED (stock already deducted) ────────────
        order.setStatus("CONFIRMED");
        Order savedOrder = orderRepository.save(order);
        log.info("Order {} saved with status CONFIRMED", savedOrder.getId());

        // ── 3. Payment ─────────────────────────────────────────────────────────
        try {
            Map<String, Object> paymentReq = new HashMap<>();
            paymentReq.put("orderId",       savedOrder.getId());
            paymentReq.put("amount",        savedOrder.getAmount() != null ? savedOrder.getAmount() : 0.0);
            paymentReq.put("paymentMethod", "CREDIT_CARD");
            paymentReq.put("status",        "SUCCESS");
            restTemplate.postForObject(paymentServiceUrl + "/payments", paymentReq, Object.class);
            log.info("Payment initiated for order {}", savedOrder.getId());
        } catch (Exception e) {
            log.error("Payment service failure for order {}: {}", savedOrder.getId(), e.getMessage());
            savedOrder.setStatus("PAYMENT_FAILED");
            savedOrder.setStatusReason("Payment processing failed: Payment Service is unavailable or returned an error (" + e.getMessage() + ")");
            orderRepository.save(savedOrder);
            throw new RuntimeException("Payment Service error: Unable to process payment (" + e.getMessage() + ")");
        }

        // ── 4. Shipping ────────────────────────────────────────────────────────
        try {
            Map<String, Object> shippingReq = new HashMap<>();
            shippingReq.put("orderId", savedOrder.getId());
            shippingReq.put("address", "Customer Shipping Address");
            shippingReq.put("status",  "PENDING");
            restTemplate.postForObject(shippingServiceUrl + "/shipments", shippingReq, Object.class);
            log.info("Shipment created for order {}", savedOrder.getId());
        } catch (Exception e) {
            log.warn("Shipping service warning for order {}: {}", savedOrder.getId(), e.getMessage());
            savedOrder.setStatusReason("Shipping warning: " + e.getMessage());
            orderRepository.save(savedOrder);
        }

        // ── 5. Mark PROCESSING ─────────────────────────────────────────────────
        savedOrder.setStatus("PROCESSING");
        Order processingOrder = orderRepository.save(savedOrder);

        // ── 6. Notification ────────────────────────────────────────────────────
        try {
            Map<String, Object> notifReq = new HashMap<>();
            notifReq.put("userId",  savedOrder.getCustomerId());
            notifReq.put("type",    "ORDER_CONFIRMED");
            notifReq.put("message", "Order #" + processingOrder.getId() + " confirmed and is being processed!");
            notifReq.put("status",  "SENT");
            restTemplate.postForObject(notificationServiceUrl + "/notifications", notifReq, Object.class);
        } catch (Exception e) {
            log.warn("Notification service warning for order {}: {}", savedOrder.getId(), e.getMessage());
        }

        return processingOrder;
    }

    // ── Admin: update order status ────────────────────────────────────────────

    public Order updateOrderStatus(Long orderId, OrderStatusUpdateRequest req) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new OrderNotFoundException(orderId));

        String newStatus = req.getStatus().toUpperCase();
        log.info("Admin updating order {} status: {} → {}", orderId, order.getStatus(), newStatus);

        order.setStatus(newStatus);
        if (req.getReason() != null && !req.getReason().isBlank()) {
            order.setStatusReason(req.getReason());
        }

        Order updated = orderRepository.save(order);

        // Notify customer of status change
        try {
            Map<String, Object> notifReq = new HashMap<>();
            notifReq.put("userId",  updated.getCustomerId());
            notifReq.put("type",    "ORDER_STATUS_UPDATED");
            notifReq.put("message", "Your order #" + orderId + " status has been updated to " + newStatus);
            notifReq.put("status",  "SENT");
            restTemplate.postForObject(notificationServiceUrl + "/notifications", notifReq, Object.class);
        } catch (Exception e) {
            log.warn("Notification warning on status update for order {}: {}", orderId, e.getMessage());
        }

        return updated;
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    public List<Order> getAllOrders() {
        return orderRepository.findAll();
    }

    public Optional<Order> getOrderById(Long id) {
        return orderRepository.findById(id);
    }

    public List<Order> getOrdersByCustomer(Long customerId) {
        return orderRepository.findByCustomerId(customerId);
    }

    public List<Order> getOrdersByStatus(String status) {
        return orderRepository.findByStatus(status.toUpperCase());
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private void failOrder(Order order, String reason) {
        order.setStatus("FAILED");
        order.setStatusReason(reason);
        orderRepository.save(order);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseErrorBody(HttpClientErrorException e) {
        try {
            // Spring's RestTemplate stores the response body as a String in the exception
            String body = e.getResponseBodyAsString();
            // Simple parse — avoid pulling in Jackson manually; use the already-present ObjectMapper
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            return mapper.readValue(body, Map.class);
        } catch (Exception ignored) {
            return new HashMap<>();
        }
    }
}
