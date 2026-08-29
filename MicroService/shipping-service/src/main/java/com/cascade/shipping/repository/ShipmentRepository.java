package com.cascade.shipping.repository;

import com.cascade.shipping.entity.Shipment;
import org.springframework.data.mongodb.repository.MongoRepository;

public interface ShipmentRepository extends MongoRepository<Shipment, Long> {}
