<script lang="ts">
  // Illustrative stained-glass panel: an arched rose-fan window over a diamond
  // field. Rendered document content — glass fills use the vitrail palette,
  // lead lines use ink, per the canvas-boundary rule.
</script>

<svg
  viewBox="0 0 260 340"
  xmlns="http://www.w3.org/2000/svg"
  role="img"
  aria-label="Stained glass panel design: an arched fan window above a diamond field"
>
  <!-- Fan pieces (arch) -->
  <g class="lead">
    <path class="ruby-tint" d="M130 150 L20 150 A110 110 0 0 1 35 95 Z" />
    <path class="cobalt-tint" d="M130 150 L35 95 A110 110 0 0 1 75 55 Z" />
    <path class="emerald-tint" d="M130 150 L75 55 A110 110 0 0 1 130 40 Z" />
    <path class="amber-tint" d="M130 150 L130 40 A110 110 0 0 1 185 55 Z" />
    <path class="violet-tint" d="M130 150 L185 55 A110 110 0 0 1 225 95 Z" />
    <path class="cobalt-tint" d="M130 150 L225 95 A110 110 0 0 1 240 150 Z" />
    <!-- Fan hub -->
    <path class="amber-glass" d="M80 150 A50 50 0 0 1 180 150 Z" />
  </g>

  <!-- Lower field: diamond and corner pieces -->
  <g class="lead">
    <path class="emerald-tint" d="M20 150 L130 150 L130 165 L35 240 L20 240 Z" />
    <path class="violet-tint" d="M130 150 L240 150 L240 240 L225 240 L130 165 Z" />
    <path class="amber-tint" d="M240 240 L240 330 L130 330 L130 315 L225 240 Z" />
    <path class="ruby-tint" d="M20 240 L35 240 L130 315 L130 330 L20 330 Z" />
    <path class="cobalt-glass" d="M130 165 L225 240 L130 315 L35 240 Z" />
  </g>

  <!-- Outer came -->
  <path class="frame" d="M20 330 V150 A110 110 0 0 1 240 150 V330 Z" />
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    height: auto;
  }

  .lead path {
    stroke: var(--ink-800);
    stroke-width: 5;
    stroke-linejoin: round;
  }

  .frame {
    fill: none;
    stroke: var(--ink-900);
    stroke-width: 10;
    stroke-linejoin: round;
  }

  .ruby-tint {
    fill: var(--ruby-100);
  }
  .amber-tint {
    fill: var(--amber-100);
  }
  .emerald-tint {
    fill: var(--emerald-100);
  }
  .violet-tint {
    fill: var(--violet-100);
  }
  .cobalt-tint {
    fill: var(--cobalt-100);
  }
  .amber-glass {
    fill: var(--amber-600);
  }
  .cobalt-glass {
    fill: var(--cobalt-600);
  }
</style>
