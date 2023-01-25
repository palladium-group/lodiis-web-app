import React from "react";
import i18n from "@dhis2/d2-i18n";
import {AreaContainer} from "../AreaContainer";
import {useData} from "../../hooks/data";
import {Stage} from "./components/Stage";
import {isEmpty} from "lodash";
import EmptyList from "../../../../../../shared/components/EmptyList";


export function StagesArea() {
    const {profileData: profile} = useData();

    const stages = profile?.getProgramStages();

    return (
        <AreaContainer heading={i18n.t("Services")}>
            {
                isEmpty(stages) && (<div className="column center align-center" style={{minHeight: "400px"}}>
                    <EmptyList message={i18n.t("There are no services provided for this beneficiary")}/>
                </div>)
            }
            {
                !isEmpty(stages) && (<div style={{padding: "0 8px"}} className="column gap-16">
                    {
                        stages?.map(programStage => (
                            <Stage key={`${programStage.id}-area`} stage={programStage}/>))
                    }
                </div>)
            }
        </AreaContainer>
    )
}
