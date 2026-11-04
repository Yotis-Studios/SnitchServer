<template>
    <div class="container-fluid py-2">
        <div class="d-flex gap-3 align-items-center mb-2">
            <div class="btn-group btn-group-sm">
                <button v-for="s in ['open', 'resolved', 'all']" :key="s" class="btn"
                        :class="show === s ? 'btn-dark' : 'btn-outline-dark'" @click="show = s">{{ s }}</button>
            </div>
            <span class="text-muted small">{{ visible.length }} of {{ groups.length }} groups</span>
        </div>
        <div v-for="group in visible" :key="group.fingerprint">
            <crash-group :group="group" :showGame="!game" @changed="getData" />
        </div>
        <div v-if="!visible.length" class="text-center">
            <p class="text-muted">{{ displayText }}</p>
        </div>
    </div>
</template>

<script>
import CrashGroup from './CrashGroup.vue';

// Crashes arrive grouped: the same error from every player and every version is one row with a
// count, not a page of identical cards. A group opens to its occurrences (CrashCard).
export default {
    components: { CrashGroup },
    props: { game: { type: String, default: '' } },
    data() {
        return {
            // "Loading", "none found" and "the request failed" must not look alike: a 401 or a
            // dead server reading as "no crashes" is good news that is not true.
            displayText: 'Loading...',
            groups: [],
            show: 'open',
        };
    },
    computed: {
        visible() {
            const open = (g) => g.status !== 'resolved';
            const list = this.groups.filter((g) => this.show === 'all' || (this.show === 'open') === open(g));
            // Regressions first (a fix that did not hold), then by most recent.
            return list.sort((a, b) => (b.status === 'regressed') - (a.status === 'regressed') || b.lastSeen - a.lastSeen);
        },
    },
    mounted() {
        this.getData();
    },
    methods: {
        getData() {
            const params = this.game ? { game: this.game } : {};
            this.$http.get('/api/crash/groups', { params }).then(
                (response) => {
                    this.groups = response.data;
                    this.displayText = 'No crashes here!';
                },
                (error) => {
                    console.log(error);
                    this.displayText = 'Error loading crashes';
                }
            );
        },
    },
}
</script>
