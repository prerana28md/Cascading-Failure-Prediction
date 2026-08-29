package com.cascade.payment.repository;

import com.cascade.payment.entity.Payment;
import org.springframework.data.mongodb.repository.MongoRepository;

public interface PaymentRepository extends MongoRepository<Payment, Long> {}
