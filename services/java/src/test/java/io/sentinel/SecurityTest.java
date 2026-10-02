package io.sentinel;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class SecurityTest {
  @Test
  void passwordHashUsesSaltAndRejectsWrongPassword() {
    var one = Security.passwordHash("correct-password");
    var two = Security.passwordHash("correct-password");
    assertNotEquals(one, two);
    assertTrue(Security.verify("correct-password", one));
    assertFalse(Security.verify("wrong-password", one));
  }

  @Test
  void rejectsUnknownVendorAndUnboundedAmounts() {
    assertThrows(
        Security.Failure.class,
        () -> Security.validate(new Security.Purchase("Purchase", 1L, "http://127.0.0.1")));
    assertThrows(
        Security.Failure.class,
        () -> Security.validate(new Security.Purchase("Purchase", 1_000_001L, "acme")));
  }

  @Test
  void rejectsPropertyInjectionAndScalarCoercion() {
    assertThrows(
        Exception.class,
        () ->
            Security.JSON.readValue(
                "{\"title\":\"Item\",\"amountCents\":10,\"vendor\":\"acme\",\"status\":\"APPROVED\"}",
                Security.Purchase.class));
    assertThrows(
        Exception.class,
        () ->
            Security.JSON.readValue(
                "{\"title\":\"Item\",\"amountCents\":\"10\",\"vendor\":\"acme\"}",
                Security.Purchase.class));
  }
}
