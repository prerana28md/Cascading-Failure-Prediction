package com.cascade.delivery.entity;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

@Document(collection = "deliveries")
public class Delivery {
    @Id
    private Long id = System.currentTimeMillis();
    private Long shipmentId;
    private String status;
    private String estimatedDelivery;
    private String lastLocation;

    public Delivery() {}

    public Delivery(Long shipmentId, String status, String estimatedDelivery) {
        this.shipmentId = shipmentId;
        this.status = status;
        this.estimatedDelivery = estimatedDelivery;
        this.lastLocation = "Fulfillment Center";
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getShipmentId() {
        return shipmentId;
    }

    public void setShipmentId(Long shipmentId) {
        this.shipmentId = shipmentId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getEstimatedDelivery() {
        return estimatedDelivery;
    }

    public void setEstimatedDelivery(String estimatedDelivery) {
        this.estimatedDelivery = estimatedDelivery;
    }

    public String getLastLocation() {
        return lastLocation;
    }

    public void setLastLocation(String lastLocation) {
        this.lastLocation = lastLocation;
    }
}
