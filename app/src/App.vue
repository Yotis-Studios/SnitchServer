<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';
import CrashList from './components/CrashList.vue';
import ReportList from './components/ReportList.vue';

// Crashes first because that is what this dashboard has always been for, and because a report
// is something you go looking for rather than something you monitor.
const tab = ref('crashes');

// One server, every game: the filter applies to both tabs. Empty means all games.
const game = ref(new URLSearchParams(location.search).get('game') || '');
const games = ref([]);
onMounted(() => {
    axios.get('/api/games').then((r) => { games.value = r.data; }, (e) => console.log(e));
});
function pickGame(g) {
    game.value = g;
    const url = new URL(location.href);
    if (g) url.searchParams.set('game', g); else url.searchParams.delete('game');
    history.replaceState(null, '', url);
}
</script>

<template>
  <div>
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
      <div class="container-fluid">
        <a class="navbar-brand" href="#">Snitch Server</a>
        <ul class="navbar-nav flex-row gap-2 me-auto">
          <li class="nav-item">
            <button class="nav-link btn btn-link"
                    :class="tab === 'crashes' ? 'active text-white' : 'text-secondary'"
                    @click="tab = 'crashes'">Crashes</button>
          </li>
          <li class="nav-item">
            <button class="nav-link btn btn-link"
                    :class="tab === 'reports' ? 'active text-white' : 'text-secondary'"
                    @click="tab = 'reports'">Reports</button>
          </li>
        </ul>
        <select class="form-select form-select-sm w-auto" :value="game" @change="pickGame($event.target.value)">
          <option value="">All games</option>
          <option v-for="g in games" :key="g.game" :value="g.game">
            {{ g.game }} ({{ g.crashes }} crashes, {{ g.reports }} reports)
          </option>
        </select>
      </div>
    </nav>

    <!-- v-if rather than v-show: each list fetches on mount, so switching tabs re-fetches and the
         view is current. The key re-mounts a list when the game filter changes, for the same reason. -->
    <CrashList v-if="tab === 'crashes'" :game="game" :key="'c' + game" />
    <ReportList v-if="tab === 'reports'" :game="game" :key="'r' + game" />
  </div>
</template>

<style>
</style>
