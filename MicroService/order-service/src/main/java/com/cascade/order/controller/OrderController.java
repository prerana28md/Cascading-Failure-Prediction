package com.cascade.order.controller;

import com.cascade.order.dto.OrderStatusUpdateRequest;
import com.cascade.order.entity.Order;
import com.cascade.order.service.OrderService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping({"/order", "/orders"})
@CrossOrigin
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    // ── Public endpoints (any authenticated user) ─────────────────────────────

    /** Place a new order. Fails immediately if product is out of stock. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ResponseEntity<Order> create(@RequestBody Order order) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(orderService.processOrder(order));
    }

    /** List all orders. */
    @GetMapping
    public List<Order> all() {
        return orderService.getAllOrders();
    }

    /** Get a single order by id. */
    @GetMapping("/{id}")
    public ResponseEntity<Order> get(@PathVariable Long id) {
        return orderService.getOrderById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /** List orders for a specific customer. */
    @GetMapping("/customer/{customerId}")
    public List<Order> byCustomer(@PathVariable Long customerId) {
        return orderService.getOrdersByCustomer(customerId);
    }

    /** List orders by status (e.g. PENDING, PROCESSING). */
    @GetMapping("/status/{status}")
    public List<Order> byStatus(@PathVariable String status) {
        return orderService.getOrdersByStatus(status);
    }

    // ── Admin-only endpoints ──────────────────────────────────────────────────

    /**
     * Update the status of an existing order.
     * Restricted to users with the ADMIN role.
     * Body: { "status": "CANCELLED", "reason": "optional note" }
     */
    @PutMapping("/{id}/status")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Order> updateStatus(
            @PathVariable Long id,
            @Valid @RequestBody OrderStatusUpdateRequest req) {
        return ResponseEntity.ok(orderService.updateOrderStatus(id, req));
    }
}
