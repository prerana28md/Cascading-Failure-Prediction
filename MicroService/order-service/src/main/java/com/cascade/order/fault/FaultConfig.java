package com.cascade.order.fault;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers the FaultInterceptor with Spring MVC.
 */
@Configuration
public class FaultConfig implements WebMvcConfigurer {

    private final FaultInterceptor faultInterceptor;

    public FaultConfig(FaultInterceptor faultInterceptor) {
        this.faultInterceptor = faultInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(faultInterceptor)
                .addPathPatterns("/**")
                .excludePathPatterns("/fault/**", "/actuator/**");
    }
}
