// @ts-nocheck
import {
    exportToCsv,
    ListStorage,
    UIContainer,
    createCta,
    createSpacer,
    createTextSpan,
    HistoryTracker,
    LogCategory
} from 'browser-scraping-utils';

interface WhatsAppMember {
    profileId: string
    name?: string
    description?: string
    phoneNumber?: string
    source?: string
}


function cleanName(name: string): string {
    const nameClean = name.trim()
    return nameClean.replace('~ ', '')
}

function cleanDescription(description: string): string | null {
    const descriptionClean = description.trim()
    if (
        !descriptionClean.match(/Loading About/i) &&
        !descriptionClean.match(/I am using WhatsApp/i) &&
        !descriptionClean.match(/Available/i)
    ) {
        return descriptionClean
    }
    return null;
}


class WhatsAppStorage extends ListStorage<WhatsAppMember> {
    constructor(options?: any) {
        super(options)
    }
    get headers() {
        return [
            'Phone Number',
            'Name',
            'Description',
            'Source'
        ]
    }
    itemToRow(item: WhatsAppMember): string[] {
        return [
            item.phoneNumber ? item.phoneNumber : "",
            item.name ? item.name : "",
            item.description ? item.description : "",
            item.source ? item.source : ""
        ]
    }
}

const memberListStore = new WhatsAppStorage({
    name: "whatsapp-scraper"
});
const counterId = 'scraper-number-tracker'
const exportName = 'whatsAppExport';
let logsTracker: HistoryTracker;

async function updateConter() {
    // Update member tracker counter
    const tracker = document.getElementById(counterId)
    if (tracker) {
        // @ts-ignore
        const countValue = await memberListStore.getCount();
        tracker.textContent = countValue.toString()
    }
}

const uiWidget = new UIContainer();

function buildCTABtns() {
    // History Tracker
    logsTracker = new HistoryTracker({
        onDelete: async (groupId: string) => {
            // We dont have cancellable adds for now
            console.log(`Delete ${groupId}`);
            // @ts-ignore
            await memberListStore.deleteFromGroupId(groupId);
            await updateConter();
        },
        divContainer: uiWidget.history,
        maxLogs: 4
    })

    // Button Download
    const btnDownload = createCta();
    btnDownload.appendChild(createTextSpan('Download\u00A0'))
    btnDownload.appendChild(createTextSpan('0', {
        bold: true,
        idAttribute: counterId
    }))
    btnDownload.appendChild(createTextSpan('\u00A0users'))

    btnDownload.addEventListener('click', async function () {
        const timestamp = new Date().toISOString()
        // @ts-ignore
        const data = await memberListStore.toCsvData()
        try {
            exportToCsv(`${exportName}-${timestamp}.csv`, data)
        } catch (err) {
            console.error('Error while generating export');
            // @ts-ignore
            console.log(err.stack)
        }
    });

    uiWidget.addCta(btnDownload)

    // Spacer
    uiWidget.addCta(createSpacer())

    // Button Reinit
    const btnReinit = createCta();
    btnReinit.appendChild(createTextSpan('Reset'))
    btnReinit.addEventListener('click', async function () {
        // @ts-ignore
        await memberListStore.clear();
        logsTracker.cleanLogs();
        await updateConter();
    });
    uiWidget.addCta(btnReinit);

    // Draggable
    uiWidget.makeItDraggable();

    // Render
    uiWidget.render()

    // Initial
    window.setTimeout(() => {
        updateConter()
    }, 1000)
}

let sidebarObserver: MutationObserver;

function listenSidebarChanges(targetNode: Node) {
    const config = { attributes: true, childList: true, subtree: true };

    // Callback function to execute when mutations are observed
    const callback = (
        mutationList: MutationRecord[]
    ) => {
        for (const mutation of mutationList) {
            if (mutation.type === "attributes") {
                const target = mutation.target as HTMLElement;
                const tagName = target.tagName;

                // Must be a div with role="row" (sidebar rows)
                if (
                    ['div'].indexOf(tagName.toLowerCase()) === -1 ||
                    target.getAttribute("role") !== "row"
                ) {
                    continue;
                }

                const rowItem = target;

                // Use timeout to wait for all data to be displayed
                window.setTimeout(async () => {
                    // Check if it's a contact (typically has default-contact-refreshed or an <img>)
                    // Based on snippet: contacts have 'default-contact-refreshed' or an <img>
                    const isContact = rowItem.querySelector('[data-icon="default-contact-refreshed"], img');
                    const isGroup = rowItem.querySelector('[data-icon="default-group"]');

                    if (!isContact || isGroup) {
                        return; // Skip if not a contact or definitely a group
                    }

                    // Avoid headers (like "Contacts" text)
                    if (rowItem.textContent === "Contacts" || rowItem.textContent === "Groups") {
                        return;
                    }

                    let profileName = "";
                    let profileDescription = "";

                    // Name - In sidebar it's usually in a span with title
                    const titleElems = rowItem.querySelectorAll("span[title]:not(.copyable-text)");
                    if (titleElems.length > 0) {
                        const text = titleElems[0].getAttribute('title') || titleElems[0].textContent
                        if (text) {
                            const name = cleanName(text);
                            if (name && name.length > 0) {
                                profileName = name;
                            }
                        }
                    }

                    if (profileName.length === 0) {
                        return;
                    }

                    // Description/Status - In sidebar it can be under _ak8k or selectable-text
                    const descriptionElems = rowItem.querySelectorAll('span[data-testid="selectable-text"], ._ak8k');

                    if (descriptionElems.length > 0) {
                        const text = descriptionElems[0].textContent;
                        if (text) {
                            const description = cleanDescription(text);
                            if (description && description.length > 0) {
                                profileDescription = description;
                            }
                        }
                    }

                    const identifier = profileName; // Sidebar usually doesn't show phone directly

                    if (profileName) {
                        const data: {
                            name?: string,
                            description?: string,
                            phoneNumber?: string,
                            source?: string
                        } = {
                            name: profileName
                        }

                        if (profileDescription) {
                            data.description = profileDescription
                        }

                        // Use name as phone/id if we don't have phone
                        data.phoneNumber = profileName;

                        // @ts-ignore
                        await memberListStore.addElem(
                            identifier, {
                            profileId: identifier,
                            ...data
                        },
                            true // Update
                        )

                        logsTracker.addHistoryLog({
                            label: `Capturing ${profileName}`,
                            category: LogCategory.LOG
                        })

                        updateConter()
                    }
                }, 50)
            }
        }
    };

    sidebarObserver = new MutationObserver(callback);
    sidebarObserver.observe(targetNode, config);
}

function stopListeningSidebarChanges() {
    if (sidebarObserver) {
        sidebarObserver.disconnect();
    }
}


function main(): void {
    buildCTABtns();

    logsTracker.addHistoryLog({
        label: "Ready! Use the search bar",
        category: LogCategory.LOG
    })

    function bodyCallback(
        mutationList: MutationRecord[]
    ) {
        for (const mutation of mutationList) {
            if (mutation.type === "childList") {
                if (mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach((node) => {
                        const htmlNode = node as HTMLElement
                        if (!htmlNode.querySelectorAll) return;

                        // Target sidebar or search results container
                        const sidebarElems = htmlNode.querySelectorAll('[aria-label="Search results."], [aria-label="Chat list"]');
                        if (sidebarElems.length > 0) {
                            window.setTimeout(() => {
                                stopListeningSidebarChanges(); // Avoid multiple observers
                                listenSidebarChanges(sidebarElems[0]);

                                logsTracker.addHistoryLog({
                                    label: "Search active - Scroll results",
                                    category: LogCategory.LOG
                                })
                            }, 50)
                        }
                    })
                }
            }
        }
    }

    const bodyConfig = { attributes: true, childList: true, subtree: true };
    const bodyObserver = new MutationObserver(bodyCallback);

    const app = document.getElementById('app');
    if (app) {
        bodyObserver.observe(app, bodyConfig);
    }

    // Also try to find it immediately if already loaded
    const existingSidebar = document.querySelector('[aria-label="Search results."], [aria-label="Chat list"]');
    if (existingSidebar) {
        listenSidebarChanges(existingSidebar);
    }
}

main();
