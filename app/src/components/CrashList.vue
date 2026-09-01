<template>
    <div>
        <div v-for="crash in crashes" :key="crash._id" class="card">
            <crash-card :crash="crash" @crashDeleted="removeCrash" />
        </div>
        <div v-if="!crashes.length" class="text-center">
            <p class="text-muted">{{ displayText }}</p>
        </div>
    </div>
</template>

<script>
import CrashCard from './CrashCard.vue';

export default {
    components: { CrashCard },
    data() {
        return {
            // "Loading", "none found" and "the request failed" looked identical before -- all
            // three rendered as "No crashes here!", so a 401 or a dead server read as good news.
            displayText: 'Loading...',
            crashes: [],
        };
    },
    mounted() {
        this.getData();
    },
    methods: {
        getData() {
            // The password and the 401 re-prompt live in the axios interceptor (auth.js), not
            // here -- there are four authenticated requests in this app now and this used to be
            // the only one that knew about passwords.
            this.$http.get('/api/crash').then(
                (response) => {
                    this.crashes = response.data;
                    this.displayText = 'No crashes here!';
                },
                (error) => {
                    console.log(error);
                    this.displayText = 'Error loading crashes';
                }
            );
        },
        removeCrash(crash) {
            const idx = this.crashes.findIndex((c) => c._id === crash._id);
            if (idx !== -1) this.crashes.splice(idx, 1);
        },
    },
}
</script>
