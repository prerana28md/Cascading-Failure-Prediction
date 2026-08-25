package com.cascade.order.service;

import com.cascade.order.entity.Order;
import com.cascade.order.repository.OrderRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class OrderService {

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
        this.restTemplate = restTemplate;
    }

    public Order processOrder(Order order) {
        order.setStatus("PENDING");
        Order savedOrder = orderRepository.save(order);

        // 1. Call Inventory Service (Deduct stock)
        try {
            Map<String, Object> inventoryReq = new HashMap<>();
            inventoryReq.put("productId", savedOrder.getProductId());
            inventoryReq.put("quantity", savedOrder.getQuantity());
            restTemplate.postForObject(inventoryServiceUrl + "/inventory/deduct", inventoryReq, Object.class);
        } catch (Exception e) {
            System.err.println("Inventory deduction warning/error: " + e.getMessage());
            // Log & continue or handle gracefully
        }

        // 2. Call Payment Service
        try {
            Map<String, Object> paymentReq = new HashMap<>();
            paymentReq.put("orderId", savedOrder.getId());
            paymentReq.put("amount", savedOrder.getAmount() != null ? savedOrder.getAmount() : 100.0);
            paymentReq.put("paymentMethod", "CREDIT_CARD");
            paymentReq.put("status", "SUCCESS");
            restTemplate.postForObject(paymentServiceUrl + "/payments", paymentReq, Object.class);
        } catch (Exception e) {
            System.err.println("Payment processing warning/error: " + e.getMessage());
        }

        // 3. Call Shipping Service
        try {
            Map<String, Object> shippingReq = new HashMap<>();
            shippingReq.put("orderId", savedOrder.getId());
            shippingReq.put("address", "Customer Shipping Address");
            shippingReq.put("status", "SHIPPED");
            restTemplate.postForObject(shippingServiceUrl + "/shipments", shippingReq, Object.class);
        } catch (Exception e) {
            System.err.println("Shipping service warning/error: " + e.getMessage());
        }

        // 4. Update status to COMPLETED
        savedOrder.setStatus("COMPLETED");
        Order completedOrder = orderRepository.save(savedOrder);

        // 5. Send Notification
        try {
            Map<String, Object> notificationReq = new HashMap<>();
            notificationReq.put("userId", savedOrder.getCustomerId());
            notificationReq.put("type", "ORDER_SUCCESS");
            notificationReq.put("message", "Order #" + completedOrder.getId() + " placed and processed successfully!");
            notificationReq.put("status", "SENT");
            restTemplate.postForObject(notificationServiceUrl + "/notifications", notificationReq, Object.class);
        } catch (Exception e) {
            System.err.println("Notification service warning/error: " + e.getMessage());
        }

        return completedOrder;
    }

    public List<Order> getAllOrders() {
        return orderRepository.findAll();
    }

    public Optional<Order> getOrderById(Long id) {
        return orderRepository.findById(id);
    }
}
