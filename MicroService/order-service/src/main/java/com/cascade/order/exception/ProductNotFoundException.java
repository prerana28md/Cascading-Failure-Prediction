package com.cascade.order.exception;

public class ProductNotFoundException extends RuntimeException {

    private final Long productId;

    public ProductNotFoundException(Long productId) {
        super("Product not found in inventory: " + productId);
        this.productId = productId;
    }

    public Long getProductId() { return productId; }
}
