<template>
  <div class="min-h-screen p-12 bg-slate-50 dark:bg-transparent">
    <div class="max-w-7xl mx-auto">
      <h1 class="text-4xl font-bold mb-8 text-center">Typography Test - Spawner Logo</h1>
      <p class="text-center mb-12 text-slate-600 dark:text-slate-400">{{ styles.length }} styles disponibles - Trouve ton préféré !</p>

      <div class="grid gap-6">
        <div
          v-for="(style, index) in styles"
          :key="index"
          class="bg-white dark:bg-dark-800 rounded-xl p-8 border transition-all hover:shadow-lg cursor-pointer"
          :class="index === styles.length - 1 ? 'border-2 border-purple-500' : 'border-slate-200 dark:border-purple-800/30'"
          @click="applyStyle(index)"
        >
          <div class="flex items-center gap-4 mb-3">
            <img src="../assets/spawner-logo.png" alt="Logo" class="h-12 w-12" />
            <span
              class="text-3xl bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 bg-clip-text text-transparent"
              :class="style.class"
              :style="style.style"
            >
              {{ style.transform ? style.transform('Spawner') : 'Spawner' }}
            </span>
          </div>
          <p class="text-sm text-slate-600 dark:text-slate-400">
            <strong>Style {{ index + 1 }}:</strong> {{ style.description }}
          </p>
        </div>
      </div>

      <div class="mt-12 text-center">
        <button
          @click="$router.push('/projects')"
          class="px-6 py-3 bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 text-white rounded-lg font-semibold hover:shadow-xl transition-all"
        >
          Retour aux Projects
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const styles = [
  {
    class: 'font-bold tracking-tight',
    style: "font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-weight: 700; letter-spacing: -0.02em;",
    description: 'SF Pro Display - Bold, Tight (-0.02em)'
  },
  {
    class: 'font-black',
    style: "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-weight: 900; letter-spacing: -0.05em;",
    description: 'System - Ultra Bold (900), Extra Tight (-0.05em)'
  },
  {
    class: 'font-bold',
    style: "font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace; font-weight: 700; letter-spacing: -0.01em;",
    description: 'Monospace - Tech/Code style'
  },
  {
    class: 'font-bold',
    style: "font-family: 'Montserrat', 'Avenir', 'Century Gothic', sans-serif; font-weight: 700; letter-spacing: 0;",
    description: 'Montserrat - Rounded, Modern'
  },
  {
    class: '',
    style: "font-family: 'Helvetica Neue', 'Arial', sans-serif; font-weight: 300; letter-spacing: 0.05em;",
    description: 'Helvetica Neue - Thin (300), Wide spacing'
  },
  {
    class: 'font-bold uppercase',
    style: "font-family: 'Futura', 'Century Gothic', sans-serif; font-weight: 700; letter-spacing: 0.02em;",
    description: 'Futura - Geometric, Uppercase'
  },
  {
    class: 'font-black',
    style: "font-family: 'Arial Narrow', 'Impact', sans-serif; font-weight: 900; letter-spacing: -0.03em; transform: scaleX(0.85);",
    description: 'Condensed - Ultra Bold, Compressed'
  },
  {
    class: 'font-bold italic',
    style: "font-family: 'Georgia', 'Times New Roman', serif; font-weight: 700;",
    description: 'Italic - Bold, Dynamic, Slanted'
  },
  {
    class: 'font-black',
    style: "font-family: 'Inter', 'Roboto', sans-serif; font-weight: 800; letter-spacing: -0.04em;",
    description: 'Inter - Extra Bold (800), Very Tight'
  },
  {
    class: 'font-black tracking-tight',
    style: "font-family: 'Poppins', 'Raleway', sans-serif; font-weight: 900;",
    description: 'Poppins - Display, Ultra Bold'
  },
  {
    class: 'font-extrabold',
    style: "font-family: 'Oswald', 'Impact', sans-serif; font-weight: 800; letter-spacing: 0.01em;",
    description: 'Oswald - Condensed Display, Extra Bold'
  },
  {
    class: 'font-black',
    style: "font-family: 'Bebas Neue', 'League Gothic', sans-serif; font-weight: 900; letter-spacing: 0.05em;",
    description: 'Bebas Neue - Tall, Condensed, Ultra Bold',
    transform: (text: string) => text.toUpperCase()
  },
  {
    class: 'font-bold',
    style: "font-family: 'Exo 2', 'Orbitron', sans-serif; font-weight: 700; letter-spacing: 0.02em;",
    description: 'Exo 2 - Futuristic, Geometric'
  },
  {
    class: 'font-black',
    style: "font-family: 'Chakra Petch', 'Rajdhani', sans-serif; font-weight: 900; letter-spacing: 0;",
    description: 'Chakra Petch - Tech, Angular, Bold'
  },
  {
    class: 'font-bold',
    style: "font-family: 'Russo One', 'Teko', sans-serif; font-weight: 700; letter-spacing: 0.03em;",
    description: 'Russo One - Square, Industrial'
  },
  {
    class: 'font-black',
    style: "font-family: 'Archivo Black', 'Anton', sans-serif; font-weight: 900; letter-spacing: -0.02em;",
    description: 'Archivo Black - Heavy, Condensed'
  },
  {
    class: 'font-bold',
    style: "font-family: 'Barlow Condensed', sans-serif; font-weight: 800; letter-spacing: 0.01em;",
    description: 'Barlow Condensed - Modern, Extra Bold',
    transform: (text: string) => text.toUpperCase()
  },
  {
    class: 'font-extrabold',
    style: "font-family: 'Space Grotesk', sans-serif; font-weight: 800; letter-spacing: -0.01em;",
    description: 'Space Grotesk - Modern, Geometric'
  },
  {
    class: 'font-black',
    style: "font-family: 'Audiowide', 'Electrolize', sans-serif; font-weight: 900; letter-spacing: 0.02em;",
    description: 'Audiowide - Digital, Electronic'
  },
  {
    class: 'font-bold',
    style: "font-family: 'Saira Condensed', sans-serif; font-weight: 800; letter-spacing: 0;",
    description: 'Saira Condensed - Tall, Modern'
  },
  {
    class: 'font-black',
    style: "font-family: 'Righteous', sans-serif; font-weight: 900; letter-spacing: 0.01em;",
    description: 'Righteous - Retro, Bold, Curved'
  },
  {
    class: 'font-bold',
    style: "font-family: 'Teko', sans-serif; font-weight: 700; letter-spacing: 0.05em;",
    description: 'Teko - Super Condensed, Light',
    transform: (text: string) => text.toUpperCase()
  },
  {
    class: 'font-black',
    style: "font-family: 'Black Ops One', sans-serif; font-weight: 900; letter-spacing: 0.02em;",
    description: 'Black Ops One - Military, Stencil'
  },
  {
    class: 'font-extrabold',
    style: "font-family: 'Lexend', sans-serif; font-weight: 800; letter-spacing: -0.02em;",
    description: 'Lexend - Clean, Modern, Readable'
  },
  {
    class: 'font-black',
    style: "font-family: 'Kanit', sans-serif; font-weight: 900; letter-spacing: 0;",
    description: 'Kanit - Angular, Modern, Bold'
  },
  {
    class: 'font-bold',
    style: "font-family: 'Rajdhani', sans-serif; font-weight: 700; letter-spacing: 0.03em;",
    description: 'Rajdhani - Tech, Condensed, Sharp'
  },
  {
    class: 'font-black',
    style: "font-family: 'Orbitron', sans-serif; font-weight: 900; letter-spacing: 0.01em;",
    description: 'Orbitron - Futuristic, Sci-Fi'
  },
  {
    class: 'font-extrabold',
    style: "font-family: 'Rubik', sans-serif; font-weight: 800; letter-spacing: -0.01em;",
    description: 'Rubik - Rounded, Modern, Friendly'
  },
  {
    class: 'font-black',
    style: "font-family: 'Squada One', sans-serif; font-weight: 900; letter-spacing: 0.02em;",
    description: 'Squada One - Condensed, Display'
  },
  {
    class: 'font-bold',
    style: "font-family: 'Pathway Gothic One', sans-serif; font-weight: 700; letter-spacing: 0.03em;",
    description: 'Pathway Gothic - Narrow, Clean',
    transform: (text: string) => text.toUpperCase()
  },
  {
    class: 'font-black tracking-tight',
    style: "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-weight: 900;",
    description: 'ORIGINAL - System font, Black (900), Tight'
  }
];

function applyStyle(index: number) {
  console.log(`Style ${index + 1} sélectionné:`, styles[index].description);
}
</script>
