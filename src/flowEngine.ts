// src/flowEngine.ts
export enum Step {
    FETCH_PAGE,
    REFRESH_CARD,
    SPARE_CARD,
}

export interface FlowContext {
    cardId?: string;
    clubId?: string;
}

export class FlowEngine {
    ctx: FlowContext = {};
    step = Step.FETCH_PAGE;

    next() {
        switch (this.step) {
            case Step.FETCH_PAGE:
                this.step = Step.REFRESH_CARD;
                break;
            case Step.REFRESH_CARD:
                this.step = Step.SPARE_CARD;
                break;
            case Step.SPARE_CARD:
                this.step = Step.REFRESH_CARD;
                break;
        }
    }
}
