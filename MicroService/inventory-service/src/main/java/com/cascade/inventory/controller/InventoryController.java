package com.cascade.inventory.controller;

import com.cascade.inventory.entity.Inventory;
import com.cascade.inventory.repository.InventoryRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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

    @PostMapping
    public Inventory create(@RequestBody Inventory item) {
        return repository.save(item);
    }

    @GetMapping
    public List<Inventory> all() {
        return repository.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Inventory> get(@PathVariable Long id) {
        return repository.findById(id).map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/product/{productId}")
    public ResponseEntity<Inventory> getByProductId(@PathVariable Long productId) {
        return repository.findByProductId(productId).map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/deduct")
    public ResponseEntity<?> deductStock(@RequestBody Map<String, Object> request) {
        Long productId = Long.valueOf(request.get("productId").toString());
        Integer quantity = Integer.valueOf(request.get("quantity").toString());

        Optional<Inventory> optInventory = repository.findByProductId(productId);
        if (optInventory.isEmpty()) {
            // If item not tracked in db yet, allow or return 404
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Product not found in inventory", "productId", productId));
        }

        Inventory inventory = optInventory.get();
        if (inventory.getQuantity() < quantity) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", "Insufficient stock", "available", inventory.getQuantity(), "requested", quantity));
        }

        inventory.setQuantity(inventory.getQuantity() - quantity);
        repository.save(inventory);

        return ResponseEntity.ok(Map.of("status", "SUCCESS", "message", "Stock deducted", "remainingQuantity", inventory.getQuantity()));
    }
}
