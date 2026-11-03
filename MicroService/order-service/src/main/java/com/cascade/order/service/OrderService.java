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
import org.springframework.scheduling.annotation.Async;
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
    private final RestTemplate    restTemplate;

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

    @SuppressWarnings("unchecked")
    public Order processOrder(Order order) {

        if (order.getQuantity() == null || order.getQuantity() <= 0)
            throw new IllegalArgumentException("Quantity must be greater than 0");
        if (order.getProductId() == null)
            throw new IllegalArgumentException("productId is required");

        // ── 1. Stock check ────────────────────────────────────────────────────
        Map<String, Object> inventoryReq = new HashMap<>();
        inventoryReq.put("productId", order.getProductId());
        inventoryReq.put("quantity",  order.getQuantity());

        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(
                    inventoryServiceUrl + "/inventory/deduct", inventoryReq, Map.class);
            if (!response.getStatusCode().is2xxSuccessful()) {
                failOrder(order, "Inventory check failed: " + response.getStatusCode());
                throw new InsufficientStockException(order.getProductId(), order.getQuantity(), 0);
            }
            log.info("Stock deducted for product={} qty={}", order.getProductId(), order.getQuantity());

        } catch (HttpClientErrorException.NotFound e) {
            log.error("Product {} not found in inventory", order.getProductId());
            throw new ProductNotFoundException(order.getProductId());

        } catch (HttpClientErrorException.BadRequest e) {
            Map<String, Object> errorBody = parseErrorBody(e);
            int available = errorBody.containsKey("available")
                    ? Integer.parseInt(errorBody.get("available").toString()) : 0;
            throw new InsufficientStockException(order.getProductId(), order.getQuantity(), available);

        } catch (HttpClientErrorException e) {
            throw new InsufficientStockException(order.getProductId(), order.getQuantity(), 0);

        } catch (Exception e) {
            log.error("Inventory service unavailable: {}", e.getMessage());
            throw new RuntimeException("Inventory service is currently unavailable. Please try again later.");
        }

        // ── 2. Persist as CONFIRMED ───────────────────────────────────────────
        order.setStatus("CONFIRMED");
        Order savedOrder = orderRepository.save(order);
        log.info("Order {} saved CONFIRMED", savedOrder.getId());

        // ── 3. Payment (synchronous — must succeed to continue) ───────────────
        try {
            Map<String, Object> paymentReq = new HashMap<>();
            paymentReq.put("orderId",       savedOrder.getId());
            paymentReq.put("amount",        savedOrder.getAmount() != null ? savedOrder.getAmount() : 0.0);
            paymentReq.put("paymentMethod", "CREDIT_CARD");
            paymentReq.put("status",        "SUCCESS");
            restTemplate.postForObject(paymentServiceUrl + "/payments", paymentReq, Object.class);
            log.info("Payment initiated for order {}", savedOrder.getId());
        } catch (Exception e) {
            log.error("Payment failure for order {}: {}", savedOrder.getId(), e.getMessage());
            savedOrder.setStatus("PAYMENT_FAILED");
            savedOrder.setStatusReason("Payment failed: " + e.getMessage());
            orderRepository.save(savedOrder);
            throw new RuntimeException("Payment Service error: " + e.getMessage());
        }

        // ── 4. Shipping (synchronous — use actual shipping address) ───────────
        try {
            String address = (savedOrder.getShippingAddress() != null
                    && !savedOrder.getShippingAddress().isBlank())
                    ? savedOrder.getShippingAddress()
                    : "Customer Default Address";

            Map<String, Object> shippingReq = new HashMap<>();
            shippingReq.put("orderId", savedOrder.getId());
            shippingReq.put("address", address);
            shippingReq.put("status",  "PENDING");
            restTemplate.postForObject(shippingServiceUrl + "/shipments", shippingReq, Object.class);
            log.info("Shipment created for order {}", savedOrder.getId());
        } catch (Exception e) {
            log.warn("Shipping warning for order {}: {}", savedOrder.getId(), e.getMessage());
        }

        // ── 5. Mark PROCESSING ────────────────────────────────────────────────
        savedOrder.setStatus("PROCESSING");
        Order processingOrder = orderRepository.save(savedOrder);

        // ── 6. Notification (fire-and-forget in background thread) ────────────
        //    Does NOT block the HTTP response — notification failure never slows the customer.
        fireOrderNotification(processingOrder);

        return processingOrder;
    }

    /** Sends the order-confirmed notification in a background thread so it never adds latency. */
    @Async
    protected void fireOrderNotification(Order order) {
        try {
            Map<String, Object> notifReq = new HashMap<>();
            notifReq.put("userId",  order.getCustomerId());
            notifReq.put("type",    "ORDER_CONFIRMED");
            notifReq.put("message", "Order #" + order.getId() + " confirmed and is being processed!");
            notifReq.put("status",  "SENT");
            restTemplate.postForObject(notificationServiceUrl + "/notifications", notifReq, Object.class);
            log.info("Order confirmation notification sent for order {}", order.getId());
        } catch (Exception e) {
            log.warn("Notification warning for order {}: {}", order.getId(), e.getMessage());
        }
    }

    // ── Admin: update order status ────────────────────────────────────────────

    public Order updateOrderStatus(Long orderId, OrderStatusUpdateRequest req) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new OrderNotFoundException(orderId));

        String newStatus = req.getStatus().toUpperCase();
        log.info("Admin updating order {} status: {} → {}", orderId, order.getStatus(), newStatus);
        order.setStatus(newStatus);
        if (req.getReason() != null && !req.getReason().isBlank())
            order.setStatusReason(req.getReason());

        Order updated = orderRepository.save(order);

        // Fire-and-forget status update notification
        try {
            Map<String, Object> notifReq = new HashMap<>();
            notifReq.put("userId",  updated.getCustomerId());
            notifReq.put("type",    "ORDER_STATUS_UPDATED");
            notifReq.put("message", "Your order #" + orderId + " status: " + newStatus);
            notifReq.put("status",  "SENT");
            restTemplate.postForObject(notificationServiceUrl + "/notifications", notifReq, Object.class);
        } catch (Exception e) {
            log.warn("Notification warning on status update for order {}: {}", orderId, e.getMessage());
        }

        return updated;
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    public List<Order> getAllOrders()                         { return orderRepository.findAll(); }
    public Optional<Order> getOrderById(Long id)             { return orderRepository.findById(id); }
    public List<Order> getOrdersByCustomer(Long customerId)  { return orderRepository.findByCustomerId(customerId); }
    public List<Order> getOrdersByStatus(String status)      { return orderRepository.findByStatus(status.toUpperCase()); }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private void failOrder(Order order, String reason) {
        order.setStatus("FAILED");
        order.setStatusReason(reason);
        orderRepository.save(order);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseErrorBody(HttpClientErrorException e) {
        try {
            String body = e.getResponseBodyAsString();
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            return mapper.readValue(body, Map.class);
        } catch (Exception ignored) {
            return new HashMap<>();
        }
    }
}
