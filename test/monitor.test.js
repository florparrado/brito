import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContactMessage,
  classifyCandidate,
  extractCandidatesFromPage,
  parseListingText
} from "../src/monitor.js";

const options = {
  maxPrice: 2100,
  minRooms: 3,
  minArea: 80
};

test("classifies a strong long-term Dreta de l'Eixample listing as high priority", () => {
  const result = classifyCandidate(
    {
      sourceName: "Finques Test",
      zone: "Dreta de l'Eixample",
      title: "Piso en Dreta de l'Eixample",
      snippet: "Alquiler de larga estancia. 3 habitaciones. 91 m2. 1.950 € / mes. Referencia: ABC123"
    },
    options
  );

  assert.equal(result.priority, "alta prioridad");
  assert.equal(result.price, 1950);
  assert.equal(result.rooms, 3);
  assert.equal(result.area, 91);
});

test("discards temporary rentals even when size and price match", () => {
  const result = classifyCandidate(
    {
      sourceName: "Portal Test",
      zone: "Born",
      title: "Piso en el Born",
      snippet: "Alquiler de temporada de 32 dias a 11 meses. 3 habitaciones. 90 m2. 1.800 € / mes."
    },
    options
  );

  assert.equal(result.priority, "descartar");
  assert.match(result.reasons.join(" "), /temporal/);
});

test("discards listings above budget", () => {
  const result = classifyCandidate(
    {
      sourceName: "Agencia Test",
      zone: "La Ribera",
      title: "Piso familiar",
      snippet: "Alquiler de larga estancia. 3 habitaciones. 95 m2. 2.300 € / mes."
    },
    options
  );

  assert.equal(result.priority, "descartar");
});

test("keeps matching listings for review when long-term signal is missing", () => {
  const result = classifyCandidate(
    {
      sourceName: "Finques Test",
      zone: "Born",
      title: "Piso en el Born",
      snippet: "Piso en alquiler. 3 habitaciones. 86 m2. 2.000 € / mes."
    },
    options
  );

  assert.equal(result.priority, "revisar");
});

test("parses listing text", () => {
  const parsed = parseListingText("Alquiler Piso 1.553 € Referencia: Tavern_1 92 m2 3 Habitaciones 1 bano");
  assert.equal(parsed.price, 1553);
  assert.equal(parsed.area, 92);
  assert.equal(parsed.rooms, 3);
  assert.equal(parsed.reference, "Tavern_1");
});

test("builds the exact requested contact message with fallbacks", () => {
  assert.equal(
    buildContactMessage({ contactName: "Marta", reference: "ABC123" }),
    "Hola Marta! Escribo para programar una visita al piso de alquiler ABC123.\nSomos una familia de 4, y nos encajaría perfecto."
  );
  assert.equal(
    buildContactMessage({ title: "Piso en calle Bruc" }),
    "Hola! Escribo para programar una visita al piso de alquiler Piso en calle Bruc.\nSomos una familia de 4, y nos encajaría perfecto."
  );
});

test("extracts candidates from a simple agency page", () => {
  const candidates = extractCandidatesFromPage({
    source: {
      name: "Basmi Test",
      type: "finques",
      zone: "Ciutat Vella",
      contact: "test@example.com"
    },
    url: "https://example.com/alquiler",
    html: `
      <article>
        <a href="/piso-1">Piso alquiler Argenteria Born</a>
        <p>Alquiler de larga estancia. 3 habitaciones. 108 m2. 1.970 €/mes.</p>
      </article>
    `
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceName, "Basmi Test");
  assert.equal(candidates[0].url, "https://example.com/piso-1");
});
