package com.cascade.gateway.fault;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.client.SimpleClientHttpRequestFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Component
public class FaultEventSynchronizer {

    private final RestTemplate syncRestTemplate;
    private final ObjectMapper objectMapper;
    private final String omnistoreUrl;
    private final Path outboxPath;
    private final Path historyPath;
    private final Deque<Map<String, Object>> history = new ConcurrentLinkedDeque<>();
    private final ExecutorService asyncExecutor = Executors.newSingleThreadExecutor();

    public FaultEventSynchronizer(
            ObjectMapper objectMapper,
            @Value("${omnistore.events-url:http://localhost:5001/api/fault-events}") String omnistoreUrl,
            @Value("${omnistore.outbox-path:fault-event-outbox.jsonl}") String outboxPath,
            @Value("${omnistore.history-path:fault-event-history.jsonl}") String historyPath) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(400);
        requestFactory.setReadTimeout(600);
        this.syncRestTemplate = new RestTemplate(requestFactory);
        this.objectMapper = objectMapper;
        this.omnistoreUrl = omnistoreUrl;
        this.outboxPath = Path.of(outboxPath);
        this.historyPath = Path.of(historyPath);
        loadHistory();
    }

    public synchronized SyncResult record(
            String service,
            String fault,
            int delayMs,
            String status,
            String description,
            List<String> dependencies) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("fault_id", UUID.randomUUID().toString());
        event.put("service", service.replace("-service", ""));
        event.put("microservice", service);
        event.put("fault", fault.toUpperCase());
        event.put("description", description);
        event.put("timestamp", Instant.now().toString());
        event.put("duration_ms", delayMs);
        event.put("injection_duration_ms", delayMs);
        event.put("status", status);
        event.put("recovery_status", "ACTIVE".equals(status) ? "PENDING" : "RECOVERED");
        event.put("severity", initialSeverity(fault, delayMs));
        event.put("criticality_percentage", initialCriticality(fault, delayMs));
        event.put("affected_component", service);
        event.put("dependencies", dependencies);
        event.put("active_faults", activeFaultCount(service, status));
        // Flat, non-recursive history summary to prevent exponential json blowup
        event.put("recent_fault_history", recentHistorySummary());
        event.put("recommendation", "Pending live metric enrichment");
        event.put("recommendation_reason", "The monitoring API will enrich this event with observed impact and recovery evidence.");

        append(historyPath, event);
        history.addLast(event);
        trimHistory();
        append(outboxPath, event);

        // Asynchronously deliver pending events so caller HTTP thread is NEVER blocked
        asyncExecutor.submit(this::retryPending);

        return new SyncResult(true, 1, 0);
    }

    @Scheduled(fixedDelayString = "${omnistore.retry-ms:10000}")
    public synchronized void retryScheduled() {
        retryPending();
    }

    public synchronized SyncResult retryPending() {
        List<Map<String, Object>> pending;
        try {
            pending = readLines(outboxPath);
        } catch (Exception e) {
            return new SyncResult(false, 0, 1);
        }
        if (pending.isEmpty()) {
            return new SyncResult(true, 0, 0);
        }

        // Bound pending items to prevent large batches
        if (pending.size() > 30) {
            pending = new ArrayList<>(pending.subList(pending.size() - 30, pending.size()));
        }

        List<Map<String, Object>> failed = new ArrayList<>();
        int delivered = 0;
        int toProcess = Math.min(pending.size(), 5);
        for (int i = 0; i < toProcess; i++) {
            Map<String, Object> event = pending.get(i);
            if (sendWithRetry(event)) {
                delivered++;
            } else {
                failed.add(event);
            }
        }
        for (int i = toProcess; i < pending.size(); i++) {
            failed.add(pending.get(i));
        }

        rewrite(outboxPath, failed);
        return new SyncResult(failed.isEmpty(), delivered, failed.size());
    }

    private boolean sendWithRetry(Map<String, Object> event) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        try {
            ResponseEntity<String> response = syncRestTemplate.postForEntity(
                    omnistoreUrl, new HttpEntity<>(event, headers), String.class);
            return response.getStatusCode().is2xxSuccessful();
        } catch (Exception ignored) {
            return false;
        }
    }

    private int activeFaultCount(String service, String status) {
        Map<String, String> latest = new LinkedHashMap<>();
        for (Map<String, Object> event : history) {
            latest.put(String.valueOf(event.get("service")), String.valueOf(event.get("status")));
        }
        latest.put(service.replace("-service", ""), status);
        return (int) latest.values().stream().filter(value -> "ACTIVE".equals(value) || "INJECTED".equals(value)).count();
    }

    /**
     * Extracts only flat summary fields without recursive nesting.
     */
    private List<Map<String, Object>> recentHistorySummary() {
        List<Map<String, Object>> result = new ArrayList<>();
        List<Map<String, Object>> snapshot = new ArrayList<>(history);
        int start = Math.max(0, snapshot.size() - 10);
        for (int i = start; i < snapshot.size(); i++) {
            Map<String, Object> h = snapshot.get(i);
            Map<String, Object> mini = new LinkedHashMap<>();
            mini.put("service", h.get("service"));
            mini.put("fault", h.get("fault"));
            mini.put("status", h.get("status"));
            mini.put("timestamp", h.get("timestamp"));
            result.add(mini);
        }
        return result;
    }

    private String initialSeverity(String fault, int delayMs) {
        if ("DOWN".equalsIgnoreCase(fault)) return "CRITICAL";
        if ("ERROR".equalsIgnoreCase(fault)) return "MAJOR";
        if ("LATENCY".equalsIgnoreCase(fault) && delayMs >= 1500) return "MODERATE";
        return "MINOR";
    }

    private int initialCriticality(String fault, int delayMs) {
        if ("DOWN".equalsIgnoreCase(fault)) return 70;
        if ("ERROR".equalsIgnoreCase(fault)) return 55;
        return Math.max(5, Math.min(50, delayMs / 100));
    }

    private void loadHistory() {
        history.addAll(readLines(historyPath));
        trimHistory();
    }

    private void trimHistory() {
        while (history.size() > 50) history.pollFirst();
    }

    private void append(Path path, Map<String, Object> event) {
        try {
            Path parent = path.toAbsolutePath().getParent();
            if (parent != null) Files.createDirectories(parent);
            Files.writeString(path, objectMapper.writeValueAsString(event) + System.lineSeparator(),
                    StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (Exception e) {
            // Ignore write failures to avoid breaking fault operations
        }
    }

    private void rewrite(Path path, List<Map<String, Object>> events) {
        try {
            if (events.isEmpty()) {
                Files.deleteIfExists(path);
                return;
            }
            List<String> lines = new ArrayList<>();
            for (Map<String, Object> event : events) {
                lines.add(objectMapper.writeValueAsString(event));
            }
            Files.write(path, lines, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        } catch (Exception ignored) {
        }
    }

    private List<Map<String, Object>> readLines(Path path) {
        if (!Files.exists(path)) return new ArrayList<>();
        try {
            List<String> allLines = Files.readAllLines(path, StandardCharsets.UTF_8);
            int start = Math.max(0, allLines.size() - 50);
            List<Map<String, Object>> result = new ArrayList<>();
            for (int i = start; i < allLines.size(); i++) {
                String line = allLines.get(i);
                if (!line.isBlank()) {
                    try {
                        result.add(objectMapper.readValue(line, new TypeReference<>() {}));
                    } catch (Exception ignored) {}
                }
            }
            return result;
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    public record SyncResult(boolean synchronizedNow, int delivered, int pending) {}
}
