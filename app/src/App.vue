<script setup>
import { ref } from 'vue';
import CrashList from './components/CrashList.vue';
import ReportList from './components/ReportList.vue';

// Crashes first because that is what this dashboard has always been for, and because a report
// is something you go looking for rather than something you monitor.
const tab = ref('crashes');
</script>

<template>
  <div>
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
      <div class="container-fluid">
        <a class="navbar-brand" href="#">Snitch Server</a>
        <ul class="navbar-nav flex-row gap-2">
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
      </div>
    </nav>

    <!-- v-if rather than v-show: each list fetches on mount, so switching tabs re-fetches and the
         view is current. v-show would render both once and then quietly go stale. -->
    <CrashList v-if="tab === 'crashes'" />
    <ReportList v-if="tab === 'reports'" />
  </div>
</template>

<style>
</style>
