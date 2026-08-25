package com.cascade.payment.controller;

import com.cascade.payment.entity.Payment;
import com.cascade.payment.repository.PaymentRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping({"/payment", "/payments"})
@CrossOrigin
public class PaymentController {
    private final PaymentRepository repository;
    private final RestTemplate restTemplate;

    @Value("${service.notification.url:http://localhost:8086}")
    private String notificationServiceUrl;

    public PaymentController(PaymentRepository repository, RestTemplate restTemplate) {
        this.repository = repository;
        this.restTemplate = restTemplate;
    }

    @PostMapping
    public Payment create(@RequestBody Payment payment) {
        if (payment.getStatus() == null || payment.getStatus().isEmpty()) {
            payment.setStatus("SUCCESS");
        }
        Payment savedPayment = repository.save(payment);

        // Send payment notification
        try {
            Map<String, Object> notificationRequest = new HashMap<>();
            notificationRequest.put("userId", 1L);
            notificationRequest.put("type", "PAYMENT_CONFIRMATION");
            notificationRequest.put("message", "Payment of $" + savedPayment.getAmount() + " processed for Order #" + savedPayment.getOrderId());
            notificationRequest.put("status", "SENT");
            restTemplate.postForObject(notificationServiceUrl + "/notifications", notificationRequest, Object.class);
        } catch (Exception e) {
            System.err.println("Failed to reach Notification Service: " + e.getMessage());
        }

        return savedPayment;
    }

    @GetMapping
    public List<Payment> all() {
        return repository.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Payment> get(@PathVariable Long id) {
        return repository.findById(id).map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
