package com.cascade.delivery.repository;

import com.cascade.delivery.entity.Delivery;
import org.springframework.data.mongodb.repository.MongoRepository;

public interface DeliveryRepository extends MongoRepository<Delivery, Long> {}
