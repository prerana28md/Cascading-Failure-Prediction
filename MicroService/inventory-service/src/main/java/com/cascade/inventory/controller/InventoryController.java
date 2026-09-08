package com.cascade.inventory.controller;

import com.cascade.inventory.entity.Inventory;
import com.cascade.inventory.repository.InventoryRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping({"/inventory", "/inventories"})
@CrossOrigin
public class InventoryController {

    private final InventoryRepository repository;

    public InventoryController(InventoryRepository repository) {
        this.repository = repository;
    }

    // ── Read endpoints (any authenticated user) ───────────────────────────────

    @GetMapping
    public List<Inventory> all() {
        return repository.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Inventory> get(@PathVariable Long id) {
        return repository.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/product/{productId}")
    public ResponseEntity<Inventory> getByProductId(@PathVariable Long productId) {
        return repository.findByProductId(productId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // ── Admin: create a new inventory item ───────────────────────────────────

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.CREATED)
    public ResponseEntity<Inventory> create(@RequestBody Inventory item) {
        if (item.getProductId() != null &&
            repository.findByProductId(item.getProductId()).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(null);  // duplicate product
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(repository.save(item));
    }

    // ── Admin: fully update an inventory item ─────────────────────────────────

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Inventory> update(@PathVariable Long id,
                                            @RequestBody Inventory updated) {
        return repository.findById(id).map(existing -> {
            if (updated.getProductName() != null)
                existing.setProductName(updated.getProductName());
            if (updated.getPrice() != null)
                existing.setPrice(updated.getPrice());
            if (updated.getQuantity() != null)
                existing.setQuantity(updated.getQuantity());
            return ResponseEntity.ok(repository.save(existing));
        }).orElse(ResponseEntity.notFound().build());
    }

    // ── Admin: adjust stock quantity (add or remove) ──────────────────────────

    /**
     * Directly set the stock quantity for a product.
     * Body: { "quantity": 100 }
     *
     * Use this to restock items or correct inventory discrepancies.
     */
    @PutMapping("/product/{productId}/stock")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> setStock(@PathVariable Long productId,
                                      @RequestBody Map<String, Object> request) {
        if (!request.containsKey("quantity")) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "quantity field is required"));
        }

        int newQty;
        try {
            newQty = Integer.parseInt(request.get("quantity").toString());
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "quantity must be an integer"));
        }

        if (newQty < 0) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "quantity cannot be negative"));
        }

        Optional<Inventory> opt = repository.findByProductId(productId);
        if (opt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Product not found in inventory",
                                 "productId", productId));
        }

        Inventory inventory = opt.get();
        int previous = inventory.getQuantity();
        inventory.setQuantity(newQty);
        repository.save(inventory);

        return ResponseEntity.ok(Map.of(
                "status", "UPDATED",
                "productId", productId,
                "previousQuantity", previous,
                "newQuantity", newQty
        ));
    }

    /**
     * Add stock to an existing product (restock).
     * Body: { "quantity": 50 }  — adds 50 units to current stock.
     */
    @PutMapping("/product/{productId}/restock")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> restock(@PathVariable Long productId,
                                     @RequestBody Map<String, Object> request) {
        if (!request.containsKey("quantity")) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "quantity field is required"));
        }

        int addQty;
        try {
            addQty = Integer.parseInt(request.get("quantity").toString());
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "quantity must be an integer"));
        }

        if (addQty <= 0) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "quantity to add must be greater than 0"));
        }

        Optional<Inventory> opt = repository.findByProductId(productId);
        if (opt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Product not found in inventory",
                                 "productId", productId));
        }

        Inventory inventory = opt.get();
        int previous = inventory.getQuantity();
        inventory.setQuantity(previous + addQty);
        repository.save(inventory);

        return ResponseEntity.ok(Map.of(
                "status", "RESTOCKED",
                "productId", productId,
                "addedQuantity", addQty,
                "previousQuantity", previous,
                "newQuantity", inventory.getQuantity()
        ));
    }

    // ── Internal: deduct stock (called by order-service) ─────────────────────

    /**
     * Deducts stock for a product. Returns 400 if insufficient, 404 if not found.
     * Called internally by order-service — requires any authenticated token.
     */
    @PostMapping("/deduct")
    public ResponseEntity<?> deductStock(@RequestBody Map<String, Object> request) {
        Long productId = Long.valueOf(request.get("productId").toString());
        Integer quantity = Integer.valueOf(request.get("quantity").toString());

        if (quantity <= 0) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Quantity to deduct must be greater than 0"));
        }

        Optional<Inventory> optInventory = repository.findByProductId(productId);
        if (optInventory.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Product not found in inventory",
                                 "productId", productId));
        }

        Inventory inventory = optInventory.get();
        if (inventory.getQuantity() < quantity) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", "Insufficient stock",
                                 "available", inventory.getQuantity(),
                                 "requested", quantity,
                                 "productId", productId));
        }

        inventory.setQuantity(inventory.getQuantity() - quantity);
        repository.save(inventory);

        return ResponseEntity.ok(Map.of(
                "status", "SUCCESS",
                "message", "Stock deducted",
                "productId", productId,
                "deducted", quantity,
                "remainingQuantity", inventory.getQuantity()
        ));
    }

    // ── Admin: delete an inventory item ──────────────────────────────────────

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (!repository.existsById(id)) {
            return ResponseEntity.notFound().build();
        }
        repository.deleteById(id);
        return ResponseEntity.noContent().build();
    }
}
