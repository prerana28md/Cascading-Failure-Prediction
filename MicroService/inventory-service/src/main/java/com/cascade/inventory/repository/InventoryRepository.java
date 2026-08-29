package com.cascade.inventory.repository;

import com.cascade.inventory.entity.Inventory;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.Optional;

public interface InventoryRepository extends MongoRepository<Inventory, Long> {
    Optional<Inventory> findByProductId(Long productId);
}
